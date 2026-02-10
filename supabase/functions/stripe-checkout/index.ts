/**
 * stripe-checkout: Supabase Edge Function
 *
 * Creates a Stripe Checkout session for:
 *   - One-time credit pack purchases (mode: "payment")
 *   - Monthly subscription plans (mode: "subscription")
 *   - Stripe Customer Portal access (action: "portal")
 *
 * Environment variables required:
 *   STRIPE_SECRET_KEY
 *   STRIPE_PRICE_STARTER / STRIPE_PRICE_PRO / STRIPE_PRICE_MEGA  (one-time)
 *   STRIPE_PRICE_SUB_BASIC / STRIPE_PRICE_SUB_PREMIUM             (recurring)
 *   SITE_URL — frontend URL for redirect
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// One-time credit packs
const PACKAGES: Record<string, { priceEnvKey: string; credits: number }> = {
  starter: { priceEnvKey: "STRIPE_PRICE_STARTER", credits: 50 },
  pro: { priceEnvKey: "STRIPE_PRICE_PRO", credits: 175 },
  mega: { priceEnvKey: "STRIPE_PRICE_MEGA", credits: 450 },
};

// Monthly subscription tiers
const SUBSCRIPTIONS: Record<string, { priceEnvKey: string; creditsPerMonth: number }> = {
  basic: { priceEnvKey: "STRIPE_PRICE_SUB_BASIC", creditsPerMonth: 150 },
  premium: { priceEnvKey: "STRIPE_PRICE_SUB_PREMIUM", creditsPerMonth: 500 },
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const SITE_URL = Deno.env.get("SITE_URL") || "http://localhost:5173";
    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: "Stripe not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2023-10-16" });
    const body = await req.json();

    // ── Portal: redirect to Stripe Customer Portal ──
    if (body.action === "portal") {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();

      if (!profile?.stripe_customer_id) {
        return new Response(
          JSON.stringify({ error: "No active subscription found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const portalSession = await stripe.billingPortal.sessions.create({
        customer: profile.stripe_customer_id,
        return_url: SITE_URL,
      });

      return new Response(
        JSON.stringify({ url: portalSession.url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Subscription checkout ──
    if (body.subscription) {
      const tierId = body.subscription as string;
      const tier = SUBSCRIPTIONS[tierId];
      if (!tier) {
        return new Response(
          JSON.stringify({ error: `Unknown subscription tier: ${tierId}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const priceId = Deno.env.get(tier.priceEnvKey);
      if (!priceId) {
        return new Response(
          JSON.stringify({ error: `Price not configured for subscription ${tierId}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Find or create Stripe customer so subscriptions are linked
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", user.id)
        .single();

      let customerId = profile?.stripe_customer_id;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          metadata: { supabase_user_id: user.id },
        });
        customerId = customer.id;
        await supabaseAdmin
          .from("profiles")
          .update({ stripe_customer_id: customerId })
          .eq("id", user.id);
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        payment_method_types: ["card"],
        line_items: [{ price: priceId, quantity: 1 }],
        client_reference_id: user.id,
        metadata: {
          user_id: user.id,
          tier: tierId,
          credits_per_month: String(tier.creditsPerMonth),
        },
        subscription_data: {
          metadata: {
            user_id: user.id,
            tier: tierId,
            credits_per_month: String(tier.creditsPerMonth),
          },
        },
        success_url: `${SITE_URL}?checkout=success`,
        cancel_url: `${SITE_URL}?checkout=cancelled`,
      });

      return new Response(
        JSON.stringify({ url: session.url }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── One-time pack checkout ──
    const packageId = body.package as string;
    const pkg = PACKAGES[packageId];
    if (!pkg) {
      return new Response(
        JSON.stringify({ error: `Unknown package: ${packageId}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const priceId = Deno.env.get(pkg.priceEnvKey);
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Price not configured for ${packageId}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: {
        user_id: user.id,
        package: packageId,
        credits: String(pkg.credits),
        type: "pack",
      },
      success_url: `${SITE_URL}?checkout=success`,
      cancel_url: `${SITE_URL}?checkout=cancelled`,
    });

    return new Response(
      JSON.stringify({ url: session.url }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Failed to create checkout" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
