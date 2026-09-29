#!/usr/bin/env python3
"""tools/phone-pdf.py -- a before/after PDF small enough to open on a phone.

ba writes full-size PNG pairs and a print-quality PDF; on a phone that is tens
of MB. This takes the side-by-side PNGs a ba run left in its --out directory
(or any PNGs given), scales each to --width px, re-encodes it as JPEG (--q),
and writes ONE PDF, a page per image, with the file name as the caption.

  python3 tools/phone-pdf.py <ba-out-dir | a.png b.png ...> -o phone.pdf [--width 1080] [--q 72]
"""
import sys, os, argparse, glob
from PIL import Image, ImageDraw

ap = argparse.ArgumentParser()
ap.add_argument("inputs", nargs="+")
ap.add_argument("-o", "--out", default="phone-before-after.pdf")
ap.add_argument("--width", type=int, default=1080)
ap.add_argument("--q", type=int, default=72)
a = ap.parse_args()

files = []
for p in a.inputs:
    if os.path.isdir(p):
        # ba's stitched pairs first; any PNG otherwise
        pairs = sorted(glob.glob(os.path.join(p, "**", "*pair*.png"), recursive=True))
        files += pairs or sorted(glob.glob(os.path.join(p, "**", "*.png"), recursive=True))
    else:
        files.append(p)
if not files:
    sys.exit("no PNGs found")

pages = []
for f in files:
    im = Image.open(f).convert("RGB")
    if im.width > a.width:
        im = im.resize((a.width, round(im.height * a.width / im.width)), Image.LANCZOS)
    cap = Image.new("RGB", (im.width, im.height + 44), (18, 20, 24))
    cap.paste(im, (0, 44))
    ImageDraw.Draw(cap).text((12, 14), os.path.splitext(os.path.basename(f))[0], fill=(230, 232, 236))
    pages.append(cap)
# JPEG inside the PDF: PIL encodes RGB pages as DCT at the given quality
pages[0].save(a.out, "PDF", save_all=True, append_images=pages[1:], quality=a.q, resolution=144)
print(os.path.abspath(a.out), f"{os.path.getsize(a.out) / 1048576:.1f} MB, {len(pages)} pages")
