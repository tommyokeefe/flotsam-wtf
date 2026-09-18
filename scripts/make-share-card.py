"""Burn the site wordmark into the fallback share image.

Run from the repo root:  python3 scripts/make-share-card.py [SRC DEST]

With no arguments it builds the site's fallback card:
Reads  src/assets/flotsam-fallback.jpg   (the untouched photograph)
Writes src/assets/flotsam-share-card.jpg (the photograph with the wordmark)

Pass SRC and DEST to brand a Post's own share image the same way, e.g.
  python3 scripts/make-share-card.py \
      src/content/posts/<slug>/share-photo.jpg src/content/posts/<slug>/share.jpg
A source already cropped to 1200x630 goes through untouched; anything else is
cover-cropped around its vertical centre, so crop it by hand first if that
would cut off something that matters.

Both are committed: the source so the card can be regenerated when the brand
changes, the output so the build has a static file to point at. Regenerate by
re-running this; don't hand-edit the output.

Nothing here is invented — every value is read off the live stylesheets:

  family  SFNS.ttf is `-apple-system`, the first family in sakura's stack
          (public/sakura-vader.css), so this is what the masthead actually
          renders in on macOS.
  weight  the 'Bold' named instance == `font-weight: 700` on h1.
  colour  #eb99a1 is sakura's `a` colour. The masthead is a link
          (`<a href="/">FLOTSAM</a>` in Layout.astro), so this — not the
          #d9d8dc that a plain heading inherits from `body` — is the colour
          FLOTSAM appears in on screen.
  scrim   #120c0e is the site background, so the darkening under the mark
          reads as the site rather than as a generic filter.

The scrim is not decoration. Measured across the photograph, every region
sits between 70 and 149 mean luminance with a standard deviation of 37-76:
mid-toned and busy everywhere, with nothing naturally dark or smooth enough
to carry a light mark unaided.
"""

import os
import sys
from PIL import Image, ImageDraw, ImageFont

SRC = "src/assets/flotsam-fallback.jpg"
DEST = "src/assets/flotsam-share-card.jpg"

# The share card geometry, matching Layout.astro's SHARE_WIDTH/SHARE_HEIGHT
# and ADR 0006. The source is already 1200x633, so this is a 3px trim.
CARD_W, CARD_H = 1200, 630

WORDMARK = "FLOTSAM"
PINK = (0xEB, 0x99, 0xA1)
DARK = (0x12, 0x0C, 0x0E)

FONT_PATH = "/System/Library/Fonts/SFNS.ttf"
FONT_SIZE = 104
# Lower left, on the baseline: the quietest corner of this photograph, and it
# leaves the driftwood — the reason the picture was chosen — unobstructed.
ORIGIN = (64, 556)


def wordmark_font():
    f = ImageFont.truetype(FONT_PATH, FONT_SIZE)
    f.set_variation_by_name("Bold")
    return f


def to_card(im):
    w, h = im.size
    scale = max(CARD_W / w, CARD_H / h)
    im = im.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
    w, h = im.size
    top = (h - CARD_H) // 2
    return im.crop((0, top, CARD_W, top + CARD_H))


def scrim_bottom(im, start=0.38, max_alpha=205):
    """Fade the site background up from the bottom edge."""
    w, h = im.size
    grad = Image.new("L", (1, h))
    for y in range(h):
        t = (y / h - start) / (1 - start)
        grad.putpixel((0, y), 0 if t < 0 else int(max_alpha * (t ** 1.5)))
    return Image.composite(Image.new("RGB", (w, h), DARK), im, grad.resize((w, h)))


def main():
    if len(sys.argv) not in (1, 3):
        sys.exit("usage: make-share-card.py [SRC DEST]")
    src, dest = sys.argv[1:] or (SRC, DEST)
    card = scrim_bottom(to_card(Image.open(src).convert("RGB")))

    font = wordmark_font()
    draw = ImageDraw.Draw(card)
    # A soft shadow, so the mark holds up wherever the scrim is thinnest.
    draw.text((ORIGIN[0] + 3, ORIGIN[1] + 3), WORDMARK, font=font,
              fill=(0, 0, 0), anchor="ls")
    draw.text(ORIGIN, WORDMARK, font=font, fill=PINK, anchor="ls")

    card.save(dest, quality=90, optimize=True, progressive=True)
    print("wrote %s  %dx%d  %.0f KB"
          % (dest, card.width, card.height, os.path.getsize(dest) / 1024))


main()
