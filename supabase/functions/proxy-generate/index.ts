/**
 * proxy-generate: Supabase Edge Function
 *
 * Receives generation requests from authenticated users, verifies their credit
 * balance, forwards the request to xAI, deducts credits on success, and logs usage.
 *
 * Environment variables required:
 *   XAI_API_KEY — your server-side xAI API key
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const XAI_API_BASE = "https://api.x.ai/v1";

const CREDIT_COSTS = {
  image: 1,          // per image
  videoPerSecond: 1,  // per second of video
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function calculateCost(
  action: string,
  imageCount: number,
  videoDuration: number,
): number {
  switch (action) {
    case "generate-image":
    case "edit-image":
      return CREDIT_COSTS.image * imageCount;
    case "generate-video":
      return CREDIT_COSTS.videoPerSecond * videoDuration;
    default:
      return 1;
  }
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const XAI_API_KEY = Deno.env.get("XAI_API_KEY");
    if (!XAI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Server API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Parse request body
    const body = await req.json();
    const { action, ...params } = body;

    if (!action) {
      return new Response(
        JSON.stringify({ error: "Missing 'action' field" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Calculate cost
    const imageCount = params.n || 1;
    const videoDuration = params.duration || 5;
    const cost = calculateCost(action, imageCount, videoDuration);

    // Check credit balance (using service role for atomic operations)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("sub_credits, pack_credits")
      .eq("id", user.id)
      .single();

    if (profileErr || !profile) {
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalCredits = (profile.sub_credits || 0) + (profile.pack_credits || 0);
    if (totalCredits < cost) {
      return new Response(
        JSON.stringify({
          error: `Insufficient credits. Need ${cost}, have ${totalCredits}.`,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Forward to xAI ──
    let xaiEndpoint: string;
    let xaiMethod = "POST";
    const xaiBody = { ...params };

    switch (action) {
      case "generate-image":
        xaiEndpoint = "/images/generations";
        break;
      case "edit-image":
        xaiEndpoint = "/images/edits";
        break;
      case "generate-video":
        xaiEndpoint = "/videos/generations";
        break;
      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    const xaiResponse = await fetch(`${XAI_API_BASE}${xaiEndpoint}`, {
      method: xaiMethod,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify(xaiBody),
    });

    if (!xaiResponse.ok) {
      const errText = await xaiResponse.text();
      // Don't deduct credits on failure
      return new Response(errText, {
        status: xaiResponse.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let xaiData = await xaiResponse.json();

    // ── For video: poll until complete ──
    if (action === "generate-video") {
      const requestId = xaiData.request_id || xaiData.id;
      if (requestId) {
        // Poll up to 120 times (6 minutes) at 3s intervals
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          let pollRes: Response;
          try {
            pollRes = await fetch(`${XAI_API_BASE}/videos/${requestId}`, {
              method: "GET",
              headers: { Authorization: `Bearer ${XAI_API_KEY}` },
            });
          } catch {
            continue; // network error, retry
          }

          if (pollRes.status === 202) {
            await pollRes.text().catch(() => {});
            continue;
          }

          if (!pollRes.ok) {
            const errText = await pollRes.text();
            // Don't deduct credits on failure
            return new Response(errText, {
              status: pollRes.status,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          const pollData = await pollRes.json();
          const status = pollData.status || pollData.state;

          if (status === "failed" || status === "error") {
            // Don't deduct credits on failure
            return new Response(
              JSON.stringify({ error: pollData.error?.message || "Video generation failed" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }

          const url = pollData.video?.url || pollData.video_url || pollData.url;
          if (status === "done" || status === "completed" || status === "succeeded" || url) {
            xaiData = pollData;
            break;
          }
        }
      }
    }

    // ── Deduct credits atomically ──
    const { error: deductErr } = await supabaseAdmin.rpc("deduct_credits", {
      p_user_id: user.id,
      p_amount: cost,
    });

    if (deductErr) {
      console.error("Failed to deduct credits:", deductErr.message);
      // Still return the result — the user already got their generation
    }

    // ── Log usage ──
    await supabaseAdmin.from("usage_log").insert({
      user_id: user.id,
      mode: action,
      credits_used: cost,
      prompt: params.prompt?.slice(0, 500) || null,
    });

    return new Response(JSON.stringify(xaiData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
