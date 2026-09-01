"""
Objective sharpness comparison between two clips.

"Looks better" is not evidence. At a fixed CRF the encoder spends bits on
detail, so bitrate is one signal — but blur can also be measured directly:
the variance of a Laplacian (second derivative) over a greyscale frame is high
for crisp edges and collapses toward zero as an image softens. It is the
standard blur metric and needs no reference image.

Frames are sampled across the clip rather than taken from one point, because
LTX output can drift in quality over its length.

    /tmp/gltch-work/venv/bin/python3 scripts/compare-video-sharpness.py A.mp4 B.mp4
"""
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageFilter
import numpy as np

SAMPLES = 8


def frames(path: Path, out: Path) -> list[Path]:
    """Pull SAMPLES evenly spaced frames as PNGs."""
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path),
         "-vf", f"select='not(mod(n\\,{max(1, 97 // SAMPLES)}))'",
         "-vsync", "0", "-frames:v", str(SAMPLES), str(out / "f%02d.png")],
        check=True,
    )
    return sorted(out.glob("*.png"))


def sharpness(png: Path) -> float:
    """Variance of the Laplacian — higher is crisper."""
    g = np.asarray(Image.open(png).convert("L"), dtype=np.float64)
    # 4-neighbour Laplacian kernel, applied directly rather than via PIL so the
    # result is a real second derivative and not a clamped 8-bit image.
    lap = (
        -4 * g[1:-1, 1:-1]
        + g[:-2, 1:-1] + g[2:, 1:-1]
        + g[1:-1, :-2] + g[1:-1, 2:]
    )
    return float(lap.var())


def detail_energy(png: Path) -> float:
    """High-frequency energy: how much the image changes when blurred.
    A already-soft image barely changes, a detailed one changes a lot."""
    im = Image.open(png).convert("L")
    a = np.asarray(im, dtype=np.float64)
    b = np.asarray(im.filter(ImageFilter.GaussianBlur(2)), dtype=np.float64)
    return float(np.abs(a - b).mean())


def main() -> None:
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    results = []
    for arg in sys.argv[1:3]:
        path = Path(arg)
        with tempfile.TemporaryDirectory() as td:
            fs = frames(path, Path(td))
            sharp = [sharpness(f) for f in fs]
            energy = [detail_energy(f) for f in fs]
        results.append((path.stem, float(np.mean(sharp)), float(np.mean(energy)), len(fs)))

    print(f"{'clip':<22}{'sharpness':>12}{'detail':>10}{'frames':>8}")
    for name, sharp, energy, n in results:
        print(f"{name:<22}{sharp:>12.1f}{energy:>10.2f}{n:>8}")

    (n1, s1, e1, _), (n2, s2, e2, _) = results
    print()
    print(f"sharpness: {n2} is {s2 / s1:.2f}x {n1}")
    print(f"detail   : {n2} is {e2 / e1:.2f}x {n1}")
    print("\n(variance of the Laplacian; higher = crisper. A softened render "
          "scores low even when resolution and frame count are identical.)")


if __name__ == "__main__":
    main()
