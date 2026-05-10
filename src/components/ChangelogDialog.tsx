import React from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, ImagePlus, Film, Download, Sparkles, Bug, FolderOpen, Smartphone, Share2, Users, Clock, Link2, ExternalLink, ShieldAlert, Camera, Wrench, Shield, Search, Globe, Trash2, Tag, BookOpen, Code, HelpCircle, Eye, Gem, Wallet, Key } from "lucide-react";

/* ─── Changelog entries ─── */
// Bump APP_BUILD in src/lib/version.ts when deploying.

import { APP_BUILD } from "@/lib/version";
export const LATEST_VERSION = APP_BUILD;

interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    items: { icon: React.ReactNode; text: string; tag?: "new" | "fix" | "improve" }[];
}

const CHANGELOG: ChangelogEntry[] = [
    {
        version: "2026.05.10",
        date: "May 10, 2026",
        title: "v5.1 — Chat Room, Storage Audit Trail & Checkout Diagnostics",
        items: [
            { icon: <Users className="w-3.5 h-3.5" />, text: "Lightweight chat room — four topic channels (#general, #help, #showcase, #nsfw) with ephemeral last-100 history, available from the More menu", tag: "new" },
            { icon: <Trash2 className="w-3.5 h-3.5" />, text: "Trash purge now deletes the underlying R2/Vercel Blob objects (not just the Library DB rows) when you empty trash", tag: "new" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "Admin orphan-share sweeper — one-shot script scans shares/ storage and removes blobs whose share_owners row no longer exists, with dry-run + 24h safety window", tag: "new" },
            { icon: <Eye className="w-3.5 h-3.5" />, text: "Purge audit log — new admin PURGES tab summarizes every account-deletion and cleanup run with found vs deleted counts and success rates", tag: "new" },
            { icon: <Tag className="w-3.5 h-3.5" />, text: "Owner-side LOCKED · {price} badge on your profile grid and post list so you can verify locks without opening each post", tag: "improve" },
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "Support bot launcher repositioned above the mobile bottom nav with safe-area insets, and the 'invalid issue code' send error is fixed", tag: "fix" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Subscription checkout error toasts now surface the actual Stripe code + message instead of a generic 'Checkout failed'", tag: "fix" },
        ],
    },
    {
        version: "2026.05.08",
        date: "May 8, 2026",
        title: "v5.0 — Subscriber-Only Free Credits, Cleaner UI & Always-On BYOK",
        items: [
            { icon: <Gem className="w-3.5 h-3.5" />, text: "Free credits are now subscriber-only — daily refill, spin wheel, and daily missions unlock with any active plan. Credit packs and existing balances are unaffected", tag: "new" },
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, text: "Store banner & in-app messaging clearly explain the new model and link straight to plan selection", tag: "improve" },
            { icon: <Key className="w-3.5 h-3.5" />, text: "BYOK (Bring Your Own xAI Key) is always visible from any mode — saving a key auto-switches you to BYOK so it works immediately", tag: "improve" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Heavy header cleanup — removed ASCII subtitle, collapsed Theme / Notifications / Mode-toggle / Daily Missions into a single overflow menu", tag: "improve" },
            { icon: <Eye className="w-3.5 h-3.5" />, text: "De-stacked overlays — Flash sale and Hold-to-Buy banners now show one at a time with priority, and the verify-email banner is a compact pill chip", tag: "improve" },
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "PWA install prompt deferred until the second visit so first-time users see the actual product first", tag: "improve" },
            { icon: <HelpCircle className="w-3.5 h-3.5" />, text: "How-to-Use tour expanded with Engines (GLTCH PRO / GLTCH / GROK) and Subscriber Credits steps so the walkthrough matches today's app", tag: "improve" },
        ],
    },
    {
        version: "2026.05.06",
        date: "May 6, 2026",
        title: "v4.9 — XRGE Holders, Real Discounts & Security",
        items: [
            { icon: <Gem className="w-3.5 h-3.5" />, text: "XRGE Holder program — tiers based on wallet + bank holdings (Initiate through Architect), daily on-chain snapshots, and streak multipliers for long-term holders", tag: "new" },
            { icon: <Wallet className="w-3.5 h-3.5" />, text: "XRGE Bank — new Holder tab: bind your Base wallet without a deposit, view tier ladder, streak milestones, and combined on-chain + custodial balance", tag: "new" },
            { icon: <Users className="w-3.5 h-3.5" />, text: "Holder badge on your profile when you qualify — visible to everyone for social proof", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Discounts that actually apply — holder tier stacks multiplicatively with subscription savings on credit generation (app, SEEDANCE, GLTCH PRO, and public API)", tag: "new" },
            { icon: <Clock className="w-3.5 h-3.5" />, text: "Daily free credits — still 10 base for verified accounts; Operative+ holders get extra dailies from tier and continuous-hold streak", tag: "improve" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "ComfyUI billing hardened — chained-workflow free steps locked to the Z-Image start-frame path only, with per-user rate limits", tag: "fix" },
        ],
    },
    {
        version: "2026.04.23",
        date: "April 23, 2026",
        title: "v4.8 — Social Proof Missions & Pack Buyer Fix",
        items: [
            { icon: <Share2 className="w-3.5 h-3.5" />, text: "Reddit daily mission now requires a real post URL — paste your r/GrokRunner share link to claim", tag: "improve" },
            { icon: <Share2 className="w-3.5 h-3.5" />, text: "New X (Twitter) daily mission — share a post on X and submit the link for +10 credits/day", tag: "new" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "URL deduplication — every submitted share link is unique platform-wide, no recycling old posts", tag: "new" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Credit-pack buyers unblocked — 'Failed to post story' fix for users whose Stripe customer ID never persisted on one-time purchases", tag: "fix" },
            { icon: <Wrench className="w-3.5 h-3.5" />, text: "Backfill migration retroactively unlocks posting for affected pack customers", tag: "fix" },
        ],
    },
    {
        version: "2026.04.20",
        date: "April 20, 2026",
        title: "v4.7 — Storage Hygiene & Auto-Purge",
        items: [
            { icon: <Trash2 className="w-3.5 h-3.5" />, text: "Auto-delete media — removing a post, story, or avatar now also purges the file from Vercel Blob storage", tag: "new" },
            { icon: <Trash2 className="w-3.5 h-3.5" />, text: "Share-link cleanup — deleting a generation from your Library tears down the underlying /s/:id share + metadata", tag: "new" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "Owner-only share purge — new share_owners table tracks creators so only you (or an admin) can take down your shares", tag: "new" },
            { icon: <Wrench className="w-3.5 h-3.5" />, text: "Legacy share backfill — admin endpoint scans old share JSONs and reattributes ownership where possible", tag: "improve" },
            { icon: <Clock className="w-3.5 h-3.5" />, text: "Weekly orphan-cleanup cron — sweeps Vercel Blob and removes files no longer referenced by any post, story, profile, or share (24h safety window)", tag: "new" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Stable creator-feed pagination — secondary sort by user_id prevents stalled cursors when rank scores tie", tag: "fix" },
            { icon: <Eye className="w-3.5 h-3.5" />, text: "End-of-feed indicator — clear 'You're all caught up' marker when the feed has no more pages", tag: "improve" },
        ],
    },
    {
        version: "2026.04.15",
        date: "April 15, 2026",
        title: "v4.6 — Moderation & Safety",
        items: [
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, text: "Community Guidelines — mandatory acknowledgment before posting to feed", tag: "new" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "Admin moderation — clickable offender emails navigate to user inspector", tag: "improve" },
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, text: "Profile ban button — one-click bans with permanent badge display", tag: "new" },
            { icon: <Search className="w-3.5 h-3.5" />, text: "User inspector — view prompts, posts, and stories for any account", tag: "improve" },
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, text: "Feed rules — re-read guidelines anytime via shield icon in header", tag: "new" },
        ],
    },
    {
        version: "2026.04.14",
        date: "April 14, 2026",
        title: "Creator Monetization — XRGE Locks, Wallets & Instant Payouts",
        items: [
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Creator wallets — set your Base wallet address in your profile to receive instant XRGE payments", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "XRGE lock on posts & stories — creators set an XRGE price and buyers pay directly to the creator's wallet", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Instant XRGE payouts — 80% goes straight to the creator's wallet on unlock, 20% platform fee", tag: "new" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "XRGE earnings breakdown in creator dashboard — track instant crypto income vs credit earnings", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Story lock settings dialog — set both credit and XRGE prices when posting stories from results", tag: "new" },
            { icon: <Download className="w-3.5 h-3.5" />, text: "Cash-out via XRGE — instant conversion option added to the payout system (lower minimum than bank/PayPal)", tag: "new" },
            { icon: <Wrench className="w-3.5 h-3.5" />, text: "Credit costs synced — API docs and frontend now show consistent pricing across all generation modes", tag: "improve" },
        ],
    },
    {
        version: "2026.04.08",
        date: "April 8, 2026",
        title: "Security Fixes, Daily Credits & Code Cleanup",
        items: [
            { icon: <Shield className="w-3.5 h-3.5" />, text: "Admin check moved server-side — no more hardcoded email in client code; uses is_admin flag from /auth/me", tag: "fix" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Daily free credits restored — 10 free credits per day after email verification", tag: "new" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Duplicate cleanup calls removed — fixed redundant comfyJobStarts delete calls in generation hook", tag: "fix" },
            { icon: <Wrench className="w-3.5 h-3.5" />, text: "Telegram Ultra pack synced — bot now correctly shows 2200 credits matching the web store", tag: "fix" },
            { icon: <Code className="w-3.5 h-3.5" />, text: "API catch-all rewrite — /api/v1/* routes no longer fall through to the SPA on Vercel", tag: "fix" },
            { icon: <Globe className="w-3.5 h-3.5" />, text: "API playground base URL fixed — playground now calls the correct backend endpoint", tag: "fix" },
        ],
    },
    {
        version: "2026.03.29",
        date: "March 29, 2026",
        title: "Simple Mode, Guided Walkthrough & Developer API",
        items: [
            { icon: <Eye className="w-3.5 h-3.5" />, text: "Simple Mode — beginner-friendly UI with three tabs: Edit Image, Create Image, Make Video. Toggle in the header anytime", tag: "new" },
            { icon: <HelpCircle className="w-3.5 h-3.5" />, text: "Guided walkthrough — step-by-step onboarding tour in Simple Mode walks new users through their first edit", tag: "new" },
            { icon: <HelpCircle className="w-3.5 h-3.5" />, text: "Restart Tour button — replay the walkthrough anytime from Simple Mode", tag: "new" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Post-generation results tip — auto-shows after first generation to explain download, re-edit, and Library", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "BYOK toggle hidden in Simple Mode — credits-only for a cleaner experience", tag: "improve" },
            { icon: <BookOpen className="w-3.5 h-3.5" />, text: "Developer docs page at /docs — endpoint specs, auth guide, code examples in Python/JS/curl, and interactive API playground", tag: "new" },
            { icon: <Code className="w-3.5 h-3.5" />, text: "/api/v1/generate now supports GLTCH and ComfyUI engines — access all generation engines via the API", tag: "new" },
            { icon: <Code className="w-3.5 h-3.5" />, text: "/api/v1/models endpoint — discover all available models and their credit costs", tag: "new" },
        ],
    },
    {
        version: "2026.03.16d",
        date: "March 16, 2026",
        title: "LongLook Fixes & UI Polish",
        items: [
            { icon: <Film className="w-3.5 h-3.5" />, text: "LongLook playback speed fixed — WAN 2.2 outputs 16fps natively; RIFE now correctly interpolates 16→32fps for normal playback", tag: "fix" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "LongLook upscale model fixed — RealESRGAN_x2plus.pth used (was missing RealESRGAN_x2.pth); entrypoint auto-downloads when needed", tag: "fix" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Loading spinner updated — circular ring replaces the old '2 sticks' animation in COMFY_QUEUE job status", tag: "improve" },
        ],
    },
    {
        version: "2026.03.16c",
        date: "March 16, 2026",
        title: "Trash, Referral Links & Version Tracking",
        items: [
            { icon: <Trash2 className="w-3.5 h-3.5" />, text: "Trash system — deleting an image moves it to Trash instead of permanent delete; restore anytime from the Trash tab", tag: "new" },
            { icon: <Trash2 className="w-3.5 h-3.5" />, text: "Delete confirmation — 'Are you sure?' dialog before removing images prevents accidental loss", tag: "new" },
            { icon: <Link2 className="w-3.5 h-3.5" />, text: "Share links now include your referral code — anyone who signs up from your shared art earns you credits", tag: "new" },
            { icon: <Tag className="w-3.5 h-3.5" />, text: "Version number auto-updates across all UI surfaces from a single source of truth", tag: "improve" },
        ],
    },
    {
        version: "2026.03.16b",
        date: "March 16, 2026",
        title: "Library Page, Share Links & Security Hardening",
        items: [
            { icon: <FolderOpen className="w-3.5 h-3.5" />, text: "Dedicated Library page — browse, search, and filter all your generations in one place", tag: "new" },
            { icon: <FolderOpen className="w-3.5 h-3.5" />, text: "Generate into folders — pick a target folder before generating so results auto-sort", tag: "new" },
            { icon: <Share2 className="w-3.5 h-3.5" />, text: "Enhanced share pages — shared links now show the image, prompt, and 'Try this prompt' CTA for social previews", tag: "new" },
            { icon: <Globe className="w-3.5 h-3.5" />, text: "SEO optimization — Open Graph, Twitter Cards, structured data, sitemap, and robots.txt for better discoverability", tag: "improve" },
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "Mobile layout fixes — action buttons wrap properly, no more overflow on small screens", tag: "fix" },
            { icon: <Shield className="w-3.5 h-3.5" />, text: "Security hardening — rate limiting, SSRF protection, HSTS, and error sanitization across all endpoints", tag: "improve" },
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "iPhone HEIC upload fix — large photos auto-resize to prevent 413 errors", tag: "fix" },
        ],
    },
    {
        version: "2026.03.16",
        date: "March 16, 2026",
        title: "Smooth Video Returns — GPU-Accelerated RIFE",
        items: [
            { icon: <Film className="w-3.5 h-3.5" />, text: "RIFE frame interpolation rebuilt with GPU-accelerated engine — 32fps smooth video is back", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "HD mode outputs 64fps buttery smooth video with dual RIFE passes", tag: "improve" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Optional second reference image for Klein image edits — dual-image conditioning", tag: "new" },
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "HEIF/HEIC file support fixed — iPhone photos now upload and convert automatically", tag: "fix" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "End frame for WAN video — upload a target frame for start→end video interpolation", tag: "fix" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Character videos upgraded from 12fps baseline to 32fps RIFE-smoothed output", tag: "improve" },
        ],
    },
    {
        version: "2026.03.15",
        date: "March 15, 2026",
        title: "Flux 2 Klein — New Image Edit Engine",
        items: [
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Image edit engine replaced with Flux 2 Klein 9B — faster, sharper edits with reference-based conditioning", tag: "new" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Built-in KLEIN-Unchained and anatomy LoRAs — better quality and body accuracy out of the box", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "New sampling pipeline — CFGGuider + Flux2Scheduler with euler_ancestral for superior detail", tag: "improve" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "Character camera angles now use English prompts for better Flux 2 compatibility", tag: "improve" },
        ],
    },
    {
        version: "2026.03.13",
        date: "March 13, 2026",
        title: "Smarter Characters — Vision, Reference Images & LoRA Intelligence",
        items: [
            { icon: <Camera className="w-3.5 h-3.5" />, text: "Image upload in character chat — attach a reference photo and the character sees it via Grok Vision", tag: "new" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Reference image blending — uploaded photos merge with the character portrait for contextual media generation", tag: "new" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "LLM-driven camera angles — characters pick close-up, wide, top-down, or POV perspectives for generated media", tag: "new" },
            { icon: <Wrench className="w-3.5 h-3.5" />, text: "Flexible media tag parsing — attributes in any order, more robust extraction of LoRA and angle selections", tag: "improve" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Fixed LoRA crash — paired LoRAs no longer fail when base name isn't in the env config", tag: "fix" },
        ],
    },
    {
        version: "2026.02.19",
        date: "February 19, 2026",
        title: "Qwen Edit Overhaul & Smoother Video",
        items: [
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Qwen Edit rewritten — zoom trick (1.5x input upscale, 0.667x output downscale) for dramatically sharper image edits at any resolution", tag: "new" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Lightning LoRA baked in — 4-step acceleration LoRA auto-applied for fast, high-quality generation", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Sampler upgraded to euler_ancestral + beta scheduler for better detail and consistency", tag: "improve" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "Video HD pipeline upgraded — AI upscaler (NMKD/RealESRGAN) + RIFE 4x for buttery smooth 64fps output", tag: "improve" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Fixed output resolution — width/height now correctly treated as desired output size, no more shrinkage from zoom downscale", tag: "fix" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Removed dead HD upscale toggle — zoom trick handles quality natively, no extra credits needed", tag: "fix" },
            { icon: <Users className="w-3.5 h-3.5" />, text: "Character images now render at 1024x1360 (portrait) with zoom-enhanced detail", tag: "improve" },
        ],
    },
    {
        version: "2025.03.10",
        date: "March 10, 2025",
        title: "Grok Image Model Notice",
        items: [
            { icon: <ShieldAlert className="w-3.5 h-3.5" />, text: "Grok grok-2-image (omodel) is now heavily moderated by xAI — many prompts may be blocked or filtered", tag: "fix" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Use GLTCH (cloud.gltch.app) for best results — unrestricted generation via local ComfyUI pipelines with no content filters", tag: "improve" },
        ],
    },
    {
        version: "2025.03.09",
        date: "March 9, 2025",
        title: "Share Links, HD Smoothness & Grokker is LIVE 🚀",
        items: [
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Grokker is now live! Post your AI creations directly to grokker.gltch.app — discover, share, and subscribe to creators", tag: "new" },
            { icon: <Link2 className="w-3.5 h-3.5" />, text: "Share links — click the link icon on any result to upload & copy a permanent shareable URL", tag: "new" },
            { icon: <ExternalLink className="w-3.5 h-3.5" />, text: "Post to Grokker now transfers your media — images and videos upload automatically instead of just the caption", tag: "fix" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "HD video smoothness — RIFE ensemble mode + lanczos 2x upscale for buttery smooth 32fps output", tag: "improve" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Image HD upscale reliability — GPU cleanup prevents VRAM fragmentation on consecutive generations", tag: "fix" },
        ],
    },
    {
        version: "2025.03.08",
        date: "March 8, 2025",
        title: "v3.0 — Mobile App Experience & Character Upgrades",
        items: [
            { icon: <Smartphone className="w-3.5 h-3.5" />, text: "Mobile bottom navigation bar — 5-tab app-style nav (Create, Library, Characters, Store, More)", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Compact mobile mode selector — horizontal scroll pills replace large card grid", tag: "improve" },
            { icon: <Share2 className="w-3.5 h-3.5" />, text: "Post-generation share CTA — one-click copy Reddit post with your referral link", tag: "new" },
            { icon: <Users className="w-3.5 h-3.5" />, text: "Character chat LoRA settings — gear icon to manually select & adjust LoRA strengths", tag: "new" },
            { icon: <Clock className="w-3.5 h-3.5" />, text: "Characters now have real-time awareness — time of day, day of week, date context", tag: "new" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Character images: dual LoRA stack (skin + angles) and face structure preservation", tag: "improve" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Updated pricing: WAN video 5 cr, HD upscale 7 cr — reflected across store & UI", tag: "improve" },
        ],
    },
    {
        version: "2025.03.07b",
        date: "March 7, 2025",
        title: "Mobile Library Overhaul & Character Video Fix",
        items: [
            { icon: <FolderOpen className="w-3.5 h-3.5" />, text: "Mobile folder navigation — collapsible dropdown replaces cramped horizontal tab bar for easier browsing", tag: "new" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "Character video HD — fixed upscale parameter so HD rendering (lanczos 2x + RIFE) now activates correctly", tag: "fix" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Fixed [MEDIA_IMAGE] tags occasionally leaking into character chat text", tag: "fix" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Folder management actions (rename, PIN, vault, delete) now easier to reach on mobile", tag: "improve" },
        ],
    },
    {
        version: "2025.03.07",
        date: "March 7, 2025",
        title: "GLTCH Animate v2 — SmoothMix Lightning Edition",
        items: [
            { icon: <Film className="w-3.5 h-3.5" />, text: "WAN 2.2 SmoothMix Enhanced NSFW Lightning I2V — dual-pass pipeline with baked-in Lightning LoRAs for ultra-fast 4-step generation", tag: "new" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "Text-to-Video — type a prompt with no image, Z-Image Turbo generates start frame → WAN I2V animates it", tag: "new" },
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Start + End frame interpolation — upload two images and WAN generates the motion between them", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "CLIPVision conditioning for enhanced image-to-video quality", tag: "improve" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Tuned sampler (euler/simple), shift control, and optimized defaults per model creator recommendations", tag: "improve" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "HD upscale: lanczos 2x + ColorMatch + RIFE 2x @ 32fps post-processing", tag: "improve" },
        ],
    },
    {
        version: "2025.03.03",
        date: "March 3, 2025",
        title: "Multi-Image Editing & Export Fix",
        items: [
            { icon: <ImagePlus className="w-3.5 h-3.5" />, text: "Multi-image editing — upload up to 3 images for Grok edit mode", tag: "new" },
            { icon: <Sparkles className="w-3.5 h-3.5" />, text: "New image resolutions: 1K / 2K toggle", tag: "new" },
            { icon: <Film className="w-3.5 h-3.5" />, text: "New aspect ratios: 19.5:9, 20:9, auto", tag: "new" },
            { icon: <Zap className="w-3.5 h-3.5" />, text: "Batch count expanded to 10 images per generation", tag: "improve" },
            { icon: <Download className="w-3.5 h-3.5" />, text: "Fixed folder ZIP export — all items now download correctly", tag: "fix" },
            { icon: <Bug className="w-3.5 h-3.5" />, text: "Fixed video edit request format & expired status handling", tag: "fix" },
        ],
    },
];

/* ─── localStorage key ─── */
const SEEN_KEY = "changelog-seen-version";

export function hasUnseenChangelog(): boolean {
    return localStorage.getItem(SEEN_KEY) !== LATEST_VERSION;
}

export function markChangelogSeen(): void {
    localStorage.setItem(SEEN_KEY, LATEST_VERSION);
}

/* ─── Tag badge (TagBadge to avoid conflict with Lucide Tag icon) ─── */
function TagBadge({ type }: { type: "new" | "fix" | "improve" }) {
    const styles = {
        new: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
        fix: "bg-red-500/20 text-red-300 border-red-500/30",
        improve: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    };
    return (
        <span className={`text-[8px] font-orbitron tracking-wider px-1.5 py-0.5 rounded border ${styles[type] ?? ""}`}>
            {(type ?? "").toUpperCase()}
        </span>
    );
}

/* ─── Component ─── */
export default function ChangelogDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    // Mark as seen when opened
    React.useEffect(() => {
        if (open) markChangelogSeen();
    }, [open]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-lg bg-card border-primary/30 text-foreground p-0 overflow-hidden">
                <ChangelogHeader />

                {/* Entries */}
                <ScrollArea className="max-h-[60vh]">
                    <div className="px-6 pb-6 space-y-6">
                        {CHANGELOG.map((entry) => (
                            <div key={entry.version}>
                                {/* Version header */}
                                <div className="flex items-center gap-3 mb-3">
                                    <div className="font-orbitron text-xs tracking-wider text-primary/80">
                                        v{entry.version}
                                    </div>
                                    <div className="h-px flex-1 bg-border/30" />
                                    <div className="font-mono-share text-[9px] text-muted-foreground/40">
                                        {entry.date}
                                    </div>
                                </div>

                                <h3 className="font-rajdhani text-sm font-semibold text-foreground/90 mb-2">
                                    {entry.title}
                                </h3>

                                <ul className="space-y-2">
                                    {entry.items.map((item, i) => (
                                        <li key={i} className="flex items-start gap-2.5 group">
                                            <span className="text-primary/50 mt-0.5 shrink-0 group-hover:text-primary transition-colors">
                                                {item.icon}
                                            </span>
                                            <span className="font-rajdhani text-sm text-foreground/70 leading-snug flex-1">
                                                {item.text}
                                            </span>
                                            {item.tag && <TagBadge type={item.tag} />}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                <ChangelogFooter />
            </DialogContent>
        </Dialog>
    );
}

function ChangelogHeader() {
    const { t } = useTranslation();
    return (
        <DialogHeader className="px-6 pt-6 pb-3">
            <DialogTitle className="font-orbitron text-lg tracking-wider text-primary flex items-center gap-2">
                <Zap className="w-5 h-5" />
                {t("changelog.title")}
            </DialogTitle>
            <p className="font-mono-share text-[10px] text-muted-foreground/50 tracking-wider mt-1">
                {t("changelog.subtitle")}
            </p>
        </DialogHeader>
    );
}

function ChangelogFooter() {
    const { t } = useTranslation();
    return (
        <div className="px-6 py-3 border-t border-border/30 bg-muted/20">
            <p className="font-mono-share text-[9px] text-muted-foreground/30 text-center tracking-wider">
                {t("changelog.footer")}
            </p>
        </div>
    );
}
