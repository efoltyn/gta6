#!/usr/bin/env python3
"""tools/shark-launch-sheet.py - before/after LAUNCH strip for Shark Sim.

HARNESS TRAP: ba cannot see this moment. Its web adapter waits for the page's
readyExpression before staging a subject, and the flash CrazyGames rejected
(Cell Block Z's static card) is over by then. So tools/shark-launch-strip.mjs
records each side from the instant of navigation (Page.startScreencast), and
this stitches the two recordings into one before/after sheet (PNG + PDF).

  python3 tools/shark-launch-sheet.py BEFORE_DIR AFTER_DIR OUT_DIR [--n 8]

Each row is one side: n frames spread from the first painted frame to the
first frame of play (plus a couple after), stamped with seconds since
navigation. Timings on a loaded shared box are inflated many times over; the
ORDER of what the player sees is the point.
"""
import sys, os, json, glob
from PIL import Image, ImageDraw, ImageFont

def load(d):
    tl = json.load(open(os.path.join(d, "timeline.json")))
    return tl, [(f["t"], os.path.join(d, f["file"])) for f in tl["frames"]]

def pick(frames, n):
    if len(frames) <= n:
        return frames
    # dedupe near-identical consecutive states by sampling evenly, but always
    # keep the first and last frame
    out = [frames[int(i * (len(frames) - 1) / (n - 1))] for i in range(n)]
    return out

def font(sz):
    for p in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/Library/Fonts/Arial Bold.ttf"]:
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    n = 8
    if "--n" in sys.argv:
        n = int(sys.argv[sys.argv.index("--n") + 1])
    bdir, adir, out = a[0], a[1], a[2]
    os.makedirs(out, exist_ok=True)
    TW, TH = 400, 225
    rows = []
    for label, d in (("BEFORE  (wave-start HEAD)", bdir), ("AFTER  (working tree)", adir)):
        tl, frames = load(d)
        rows.append((label, pick(frames, n), tl))
    W = 40 + n * (TW + 10)
    H = 90 + len(rows) * (TH + 70)
    sheet = Image.new("RGB", (W, H), (14, 20, 30))
    dr = ImageDraw.Draw(sheet)
    dr.text((20, 18), "SHARK SIM - launch to first control", fill=(255, 255, 255), font=font(28))
    dr.text((20, 56), "Frames from the instant of navigation (seconds stamped; shared box under heavy load, so times are inflated).", fill=(160, 180, 200), font=font(16))
    y = 90
    for label, frames, tl in rows:
        dr.text((20, y + 4), label, fill=(255, 190, 120), font=font(20))
        x = 20
        for t, f in frames:
            im = Image.open(f).convert("RGB").resize((TW, TH))
            sheet.paste(im, (x, y + 34))
            d2 = ImageDraw.Draw(sheet)
            d2.rectangle([x, y + 34, x + 74, y + 56], fill=(0, 0, 0))
            d2.text((x + 5, y + 36), "%.1fs" % (t / 1000.0), fill=(255, 255, 255), font=font(16))
            x += TW + 10
        y += TH + 70
    png = os.path.join(out, "launch-before-after.png")
    sheet.save(png)
    sheet.save(os.path.join(out, "report.pdf"), "PDF", resolution=110)
    print(os.path.join(out, "report.pdf"))

if __name__ == "__main__":
    main()
