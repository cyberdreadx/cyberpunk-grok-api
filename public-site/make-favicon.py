"""
Build the GLTCH Runner favicon set: a simplified neon brain.

Replaces the cyan "G" wordmark icon so the tab icon, the PWA icon and the app
listing are all the same mark. The full neon-brain art can't be used directly —
it's 1024px of thin glowing line-work that turns to grey mush at the 16px a tab
strip actually renders.

So this redraws it for the small size instead of shrinking it:

  * SIDE PROFILE, NOT FRONT-ON. This is the finding that made it work. A
    symmetric front-facing brain reads as a FACE at 16px — the hemisphere
    split becomes a nose and any pair of folds becomes eyes. Four front-on
    variants were rendered and every one of them read as a mask. A profile
    has no bilateral symmetry, so there is nothing for the eye to resolve
    into a face, and the cerebellum-and-stem tail is a silhouette no other
    icon shares.
  * SOLID MASS, NOT LINE ART. At 16px a 1px stroke is the whole feature and
    anti-aliasing eats it. A filled silhouette with folds *cut out* of it
    keeps its shape, because negative space is as wide as the mass around it.
  * TWO FOLDS. Enough to say "convoluted"; a third closes up into a grey band.
  * A LUMPY CROWN. Three overlapping bumps along the top so the outline is
    lobed rather than round — this is what stops it reading as a bean.

Detail, glow and padding are all functions of size: the 16px tab icon and the
180px home-screen icon are drawn differently rather than resized from one
master, because each element that flatters the large size costs pixels the
small one cannot spare.

    python3 public-site/make-favicon.py
"""
import os

from PIL import Image, ImageDraw, ImageFilter

OUT = "/tmp/gltch-work/icons"
os.makedirs(OUT, exist_ok=True)

BG = (6, 7, 13, 255)  # --bg  #06070d
CYAN = (34, 211, 238, 255)  # --primary #22d3ee
CYAN_DIM = (14, 116, 144, 255)  # deeper cyan, for the lower mass


def render(size: int) -> Image.Image:
    """Draw the mark AT this size rather than drawing once and resizing."""
    S = size * 16
    tiny = size <= 20        # tab-strip size: strip everything inessential
    small = size <= 48

    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG)
    # The inner bezel is a nicety at 180 and a pixel thief at 16.
    if not small:
        d.rounded_rectangle(
            [int(S * 0.03)] * 2 + [S - 1 - int(S * 0.03)] * 2,
            radius=int(radius * 0.85),
            outline=(34, 211, 238, 70),
            width=max(1, int(S * 0.012)),
        )

    mass = Image.new("L", (S, S), 0)
    md = ImageDraw.Draw(mass)

    def blob(fcx, fcy, frx, fry):
        md.ellipse([(fcx - frx) * S, (fcy - fry) * S, (fcx + frx) * S, (fcy + fry) * S], fill=255)

    # ── Silhouette: brain in profile, facing left ─────────────────────────
    # Cranium, then three overlapping bumps for a lobed crown, then the
    # cerebellum low at the back and the stem below it.
    blob(0.45, 0.45, 0.30, 0.27)
    blob(0.29, 0.33, 0.150, 0.135)
    blob(0.51, 0.285, 0.155, 0.140)
    blob(0.66, 0.41, 0.145, 0.140)
    blob(0.685, 0.625, 0.160, 0.140)   # cerebellum
    md.rounded_rectangle(
        [0.44 * S, 0.62 * S, 0.56 * S, 0.83 * S], radius=int(0.05 * S), fill=255
    )

    # ── Folds, cut OUT of the mass ────────────────────────────────────────
    # Width as a fraction of the canvas so these land on ~2 real pixels at
    # 16px. Thin lines vanish into anti-aliasing; holes this wide do not.
    cut = max(2, int(S * (0.085 if tiny else 0.062)))

    md.arc([0.16 * S, 0.24 * S, 0.68 * S, 0.54 * S], 185, 355, fill=0, width=cut)
    md.arc([0.18 * S, 0.42 * S, 0.64 * S, 0.68 * S], 185, 355, fill=0, width=cut)
    if not tiny:
        # A third fold and the cerebellum's own split are legible from 32px up.
        md.arc([0.22 * S, 0.56 * S, 0.58 * S, 0.76 * S], 190, 350, fill=0, width=cut)
        md.line([(0.60 * S, 0.60 * S), (0.80 * S, 0.60 * S)], fill=0, width=cut)

    # ── Colour + glow ─────────────────────────────────────────────────────
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = min(1.0, max(0.0, (y / S - 0.28) / 0.55))
        # Tiny sizes stay near-full brightness: the ramp costs contrast against
        # the plate and buys shading nobody can see at 16px.
        t *= 0.35 if tiny else 1.0
        gd.line(
            [(0, y), (S, y)],
            fill=tuple(int(CYAN[i] + (CYAN_DIM[i] - CYAN[i]) * t) for i in range(3)) + (255,),
        )

    # Bloom is what makes it look like neon — and what makes it look like a
    # smudge when the whole icon is 16 pixels wide. Off entirely when tiny.
    if not tiny:
        glow = mass.filter(ImageFilter.GaussianBlur(S * 0.035)).point(
            lambda v: int(v * (0.35 if small else 0.55))
        )
        img.paste(Image.new("RGBA", (S, S), CYAN), (0, 0), glow)
    img.paste(grad, (0, 0), mass)

    plate = Image.new("L", (S, S), 0)
    ImageDraw.Draw(plate).rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=255)
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.paste(img, (0, 0), plate)

    return out.resize((size, size), Image.LANCZOS)


sizes = {
    "icon-16.png": 16,
    "icon-32.png": 32,
    "icon-180.png": 180,
    "apple-touch-icon.png": 180,
    "icon-512.png": 512,
}
for name, size in sizes.items():
    render(size).save(os.path.join(OUT, name))
    print(f"  {name:24} {size}x{size}")

# .ico carries every size a browser might ask for; Windows still reaches for 48.
ico = render(256)
ico.save(
    os.path.join(OUT, "favicon.ico"),
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
print(f"  {'favicon.ico':24} multi-res")

# Contact sheet: the 16px rendering is the one that decides whether this works,
# so make it inspectable rather than trusting the 512.
sheet = Image.new("RGBA", (16 * 24 + 40, 16 * 8 + 40), (20, 20, 28, 255))
x = 20
for s in (16, 32, 64):
    im = render(s)
    sheet.paste(im.resize((s * 4, s * 4), Image.NEAREST), (x, 20), im.resize((s * 4, s * 4), Image.NEAREST))
    x += s * 4 + 16
sheet.save(os.path.join(OUT, "_contact-sheet.png"))
print(f"\nwrote {OUT}")
