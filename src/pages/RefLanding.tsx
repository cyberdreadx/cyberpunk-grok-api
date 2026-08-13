/**
 * /r/:code — referral and ambassador link landing.
 *
 * This route did not exist. The referral page has always told people to share
 * `/r/CODE`, but with no matching route those links fell through to the SPA
 * catch-all and rendered the 404 page — and since the code sat in the path
 * rather than in `?ref=`, nothing captured it either. Every link handed out
 * that way was dead on both counts; the only attribution that ever worked came
 * from share links carrying `?ref=`.
 *
 * Adopt the code, then replace the history entry so Back doesn't bounce the
 * visitor through here again.
 */
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { adoptRefCode } from "@/lib/referral";

export default function RefLanding() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();

  useEffect(() => {
    adoptRefCode(code);
    navigate(code ? `/?ref=${encodeURIComponent(code.toUpperCase())}` : "/", { replace: true });
  }, [code, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-xs font-mono text-muted-foreground tracking-widest animate-pulse">
        REDIRECTING…
      </p>
    </div>
  );
}
