import { useCallback, useEffect, useMemo, useState } from "react";
import { mediaCandidates } from "@/lib/mediaUrl";
import { reportMediaError } from "@/lib/mediaErrorReporter";

/** Walk mediaCandidates on load error — shared by feed/post/reel/story surfaces. */
export function useMediaSrc(
  url: string | null | undefined,
  opts?: { kind?: "image" | "video"; context?: string },
) {
  const candidates = useMemo(() => (url ? mediaCandidates(url) : []), [url]);
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [url]);

  const src = candidates[idx] ?? url ?? "";

  const onError = useCallback(() => {
    if (src && opts?.context) {
      reportMediaError(src, opts.kind ?? "image", opts.context);
    }
    if (idx < candidates.length - 1) {
      setIdx((i) => i + 1);
    } else {
      setFailed(true);
    }
  }, [src, idx, candidates.length, opts?.context, opts?.kind]);

  return { src, onError, failed, hasUrl: !!url };
}
