"""
Measure temporal stability between two clips rendered from the same seed.

A single-frame comparison cannot see the thing that most separates
quantisation levels in video: noise that shifts frame to frame. It looks like
texture in a still and like shimmer in motion. Comparing stills is how the
previous two assessments went wrong.

Both clips here share a seed and a prompt, so their real motion is close to
identical. What differs is the noise riding on top. Frame-to-frame absolute
difference therefore separates them: the clip with more inter-frame change,
given the same underlying motion, is the noisier one.

Reported per-percentile as well as as a mean, because motion concentrates in a
few regions while noise is spread everywhere — the low percentiles are mostly
noise, and the high ones mostly genuine movement.

    /tmp/gltch-work/venv/bin/python3 scripts/temporal-noise.py A.mp4 B.mp4
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

SAMPLES = 24


def frames(path: Path, out: Path) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path),
         "-frames:v", str(SAMPLES), "-vsync", "0", str(out / "f%03d.png")],
        check=True,
    )
    return sorted(out.glob("*.png"))


def deltas(paths: list[Path]) -> np.ndarray:
    """Per-pixel absolute difference between consecutive frames."""
    arrs = [np.asarray(Image.open(p).convert("L"), dtype=np.float32) for p in paths]
    return np.stack([np.abs(b - a) for a, b in zip(arrs, arrs[1:])])


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    rows = []
    for arg in sys.argv[1:3]:
        path = Path(arg)
        with tempfile.TemporaryDirectory() as td:
            d = deltas(frames(path, Path(td)))
        # Percentiles collapse to 0 and 1 on 8-bit deltas, so they cannot
        # separate the two. What does: how much of the frame is drifting at
        # all, and how hard the quiet majority drifts. Shimmer is a large area
        # changing slightly, not a small area changing a lot.
        rows.append((
            path.stem,
            float(d.mean()),
            float((d > 2).mean() * 100),        # % of pixels moving more than noise floor
            float(d[d <= 4].mean()),            # mean drift in the quiet majority
            float(np.percentile(d, 95)),        # genuine motion, should match
        ))

    print(f"{'clip':<16}{'mean':>9}{'>2 lvl %':>10}{'quiet':>8}{'p95':>7}")
    for name, mean, moving, quiet, p95 in rows:
        print(f"{name:<16}{mean:>9.3f}{moving:>10.2f}{quiet:>8.3f}{p95:>7.1f}")

    (n1, m1, mv1, q1, p1), (n2, m2, mv2, q2, p2) = rows
    rel = lambda a, b: f"{a / b:.2f}x" if b else "n/a"
    print()
    print(f"mean frame-to-frame change : {n2} is {rel(m2, m1)} {n1}")
    print(f"area drifting above noise  : {n2} is {rel(mv2, mv1)} {n1}")
    print(f"drift in the quiet majority: {n2} is {rel(q2, q1)} {n1}")
    print(f"genuine motion (p95)       : {p1:.1f} vs {p2:.1f} — should be close, same seed")
    print("\nSame seed and prompt means real motion is near-identical, so a lower")
    print("quiet-region drift means less shimmer between frames. That is invisible")
    print("in a still and obvious in playback.")


if __name__ == "__main__":
    main()
