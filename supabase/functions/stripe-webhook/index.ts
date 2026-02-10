/**
 * stripe-webhook: Supabase Edge Function
 *
 * Handles Stripe webhook events:
 *   - checkout.session.completed  → add pack_credits (one-time purchase)
 *   - invoice.paid                → reset sub_credits (subscription renewal)
 *   - customer.subscription.deleted → clear subscription tier and sub_credits
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY — your Stripe secret key
 *   STRIPE_WEBHOOK_SECRET — webhook signing secret from Stripe dashboard
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Map tier IDs to credits per month (must match stripe-checkout)
const TIER_CREDITS: Record<string, number> = {
  basic: 150,
  premium: 500,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });

    // Verify webhook signature
    const body = await req.text();
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      return new Response(
        JSON.stringify({ error: "No Stripe signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      return new Response(
        JSON.stringify({ error: "Invalid signature" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── checkout.session.completed: one-time pack purchase ──
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only handle one-time payments (subscriptions are handled via invoice.paid)
      if (session.mode === "subscription") {
        console.log("Subscription checkout completed — waiting for invoice.paid event");
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = session.client_reference_id || session.metadata?.user_id;
      const credits = parseInt(session.metadata?.credits || "0", 10);
      const packageId = session.metadata?.package || "unknown";

      if (!userId || credits <= 0) {
        console.error("Webhook: missing user_id or credits", { userId, credits });
        return new Response(
          JSON.stringify({ error: "Missing metadata" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Add to pack_credits (never expire)
      const { error: creditErr } = await supabaseAdmin.rpc("add_pack_credits", {
        p_user_id: userId,
        p_amount: credits,
      });

      if (creditErr) {
        console.error("Failed to add pack credits:", creditErr.message);
      }

      // Record transaction
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        credits,
        amount_cents: session.amount_total || 0,
        stripe_session_id: session.id,
        package: packageId,
        type: "pack",
      });

      console.log(`Added ${credits} pack credits to user ${userId} (${packageId})`);
    }

    // ── invoice.paid: subscription renewal → reset sub_credits ──
    if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;

      // Only handle subscription invoices
      if (!invoice.subscription) {
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Retrieve subscription to get metadata and period info
      const subscription = await stripe.subscriptions.retrieve(
        invoice.subscription as string,
      );

      const userId = subscription.metadata?.user_id;
      const tier = subscription.metadata?.tier;
      const creditsPerMonth = parseInt(subscription.metadata?.credits_per_month || "0", 10);

      if (!userId || !tier || creditsPerMonth <= 0) {
        console.error("invoice.paid: missing subscription metadata", {
          userId, tier, creditsPerMonth,
          subId: subscription.id,
        });
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Calculate next renewal date from current_period_end
      const renewsAt = new Date(subscription.current_period_end * 1000).toISOString();

      // RESET (not add) subscription credits to the monthly allotment
      const { error: resetErr } = await supabaseAdmin.rpc("reset_sub_credits", {
        p_user_id: userId,
        p_amount: creditsPerMonth,
        p_tier: tier,
        p_renews_at: renewsAt,
      });

      if (resetErr) {
        console.error("Failed to reset sub credits:", resetErr.message);
      }

      // Store stripe_customer_id on profile if not already set
      if (invoice.customer) {
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_customer_id: invoice.customer as string })
          .eq("id", userId);
      }

      // Record transaction
      await supabaseAdmin.from("transactions").insert({
        user_id: userId,
        credits: creditsPerMonth,
        amount_cents: invoice.amount_paid || 0,
        stripe_session_id: invoice.id,
        package: tier,
        type: "subscription",
      });

      console.log(`Reset sub_credits to ${creditsPerMonth} for user ${userId} (${tier}), renews ${renewsAt}`);
    }

    // ── customer.subscription.deleted: subscription cancelled ──
    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata?.user_id;

      if (!userId) {
        console.error("subscription.deleted: no user_id in metadata", subscription.id);
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clear subscription tier and sub_credits
      const { error: clearErr } = await supabaseAdmin.rpc("clear_subscription", {
        p_user_id: userId,
      });

      if (clearErr) {
        console.error("Failed to clear subscription:", clearErr.message);
      }

      console.log(`Subscription cancelled for user ${userId}`);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Webhook error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
