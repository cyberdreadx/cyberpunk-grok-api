import React from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, ImagePlus, Film, Download, Sparkles, Bug, FolderOpen, Smartphone, Share2, Users, Clock, Link2, ExternalLink, ShieldAlert } from "lucide-react";

/* ─── Changelog entries ─── */
// Add new entries at the TOP. Bump LATEST_VERSION when deploying.

export const LATEST_VERSION = "2025.03.10";

interface ChangelogEntry {
    version: string;
    date: string;
    title: string;
    items: { icon: React.ReactNode; text: string; tag?: "new" | "fix" | "improve" }[];
}

const CHANGELOG: ChangelogEntry[] = [
    {
        version: "2025.03.10",
        date: "March 10, 2025",
        title: "⚠️ Grok Image Model Notice",
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

/* ─── Tag badge ─── */
function Tag({ type }: { type: "new" | "fix" | "improve" }) {
    const styles = {
        new: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
        fix: "bg-red-500/20 text-red-300 border-red-500/30",
        improve: "bg-purple-500/20 text-purple-300 border-purple-500/30",
    };
    return (
        <span className={`text-[8px] font-orbitron tracking-wider px-1.5 py-0.5 rounded border ${styles[type]}`}>
            {type.toUpperCase()}
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
                {/* Header */}
                <DialogHeader className="px-6 pt-6 pb-3">
                    <DialogTitle className="font-orbitron text-lg tracking-wider text-primary flex items-center gap-2">
                        <Zap className="w-5 h-5" />
                        CHANGELOG
                    </DialogTitle>
                    <p className="font-mono-share text-[10px] text-muted-foreground/50 tracking-wider mt-1">
                        What's new in Grok Runner
                    </p>
                </DialogHeader>

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
                                            {item.tag && <Tag type={item.tag} />}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </ScrollArea>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-border/30 bg-muted/20">
                    <p className="font-mono-share text-[9px] text-muted-foreground/30 text-center tracking-wider">
                        GROK RUNNER // POWERED BY xAI
                    </p>
                </div>
            </DialogContent>
        </Dialog>
    );
}
