"""
Build a GLTCH Runner favicon set.

The existing icon is Lovable's default gradient heart — the scaffolding tool's
logo, shipped to production on both domains. The neon-brain asset can't replace
it: it's fine at 512 but turns to mush at 16px, which is the size that actually
matters in a tab strip.

So: a bold G in the brand cyan on the near-black background, with the magenta
double-slash from the GLTCH//RUNNER wordmark as an accent. Simple enough to
stay legible at 16px, distinctive enough to find in a row of tabs.
"""
from PIL import Image, ImageDraw, ImageFont

OUT = "/tmp/claude-1002/-home-neon/5b6b055f-35b3-4494-b505-802f304e4072/scratchpad/icons"
import os; os.makedirs(OUT, exist_ok=True)

BG      = (6, 7, 13, 255)        # --bg  #06070d
CYAN    = (34, 211, 238, 255)    # --primary #22d3ee
MAGENTA = (217, 70, 239, 255)    # --secondary #d946ef
FONT    = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

def render(size: int) -> Image.Image:
    # Supersample 8x so the curves and the rounded corners stay clean when
    # they land on a 16px grid.
    S = size * 8
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    radius = int(S * 0.22)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=radius, fill=BG)

    # Thin cyan inner edge — reads as a subtle glow at large sizes and simply
    # firms up the silhouette at small ones.
    d.rounded_rectangle(
        [int(S * 0.03)] * 2 + [S - 1 - int(S * 0.03)] * 2,
        radius=int(radius * 0.85), outline=(34, 211, 238, 70), width=max(1, int(S * 0.012)),
    )

    # The G, optically centred rather than bbox-centred.
    f = ImageFont.truetype(FONT, int(S * 0.64))
    box = d.textbbox((0, 0), "G", font=f)
    gx = (S - (box[2] - box[0])) / 2 - box[0] - S * 0.045
    gy = (S - (box[3] - box[1])) / 2 - box[1] - S * 0.045
    d.text((gx, gy), "G", font=f, fill=CYAN)

    # Magenta // from the wordmark, tucked into the lower-right. Dropped below
    # 32px, where two hairlines just turn into noise.
    if size >= 32:
        w = max(1, int(S * 0.055))
        x0, y0 = int(S * 0.63), int(S * 0.70)
        h, lean, gap = int(S * 0.18), int(S * 0.06), int(S * 0.105)
        for i in range(2):
            x = x0 + i * gap
            d.line([(x, y0 + h), (x + lean, y0)], fill=MAGENTA, width=w)

    return img.resize((size, size), Image.LANCZOS)

sizes = [16, 32, 48, 64, 128, 180, 192, 256, 512]
imgs = {s: render(s) for s in sizes}
for s, im in imgs.items():
    im.save(f"{OUT}/icon-{s}.png")

# Multi-size ICO. The old one carried a single 256x256 entry, which browsers
# have to downscale themselves for the tab strip — part of why it looked soft.
imgs[256].save(f"{OUT}/favicon.ico", format="ICO",
               sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

print("wrote", OUT)
for s in sizes:
    print(f"  icon-{s}.png")
