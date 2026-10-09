#!/usr/bin/env python3
"""tools/contact-sheet.py — lay a storyboard out as one image.

Usage: python3 tools/contact-sheet.py MANIFEST.json OUT.png

MANIFEST: {"title": str, "cols": [col labels], "rows": [{"label": str,
           "cells": [path-or-null, ...]}], "thumb": [w, h], "notes": [str]}

Rows are beats (time), columns are camera spots. A missing cell is drawn as
an empty grey box so the grid never shifts. Used by tools/nuke-look.mjs.
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ("/System/Library/Fonts/Supplemental/Arial Bold.ttf",
              "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"):
        try:
            return ImageFont.truetype(p, sz)
        except Exception:
            pass
    return ImageFont.load_default()

def main():
    man = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    tw, th = man.get("thumb", [480, 270])
    cols, rows = man["cols"], man["rows"]
    LW, HH, PAD = 120, 64, 6
    notes = man.get("notes") or []
    NH = 22 * len(notes) + (10 if notes else 0)
    W = LW + len(cols) * (tw + PAD) + PAD
    H = HH + len(rows) * (th + PAD) + PAD + NH
    sheet = Image.new("RGB", (W, H), (18, 20, 24))
    d = ImageDraw.Draw(sheet)
    f1, f2, f3 = font(26), font(20), font(16)
    d.text((PAD + 4, 6), man.get("title", "storyboard"), fill=(235, 238, 242), font=f1)
    for c, lab in enumerate(cols):
        d.text((LW + c * (tw + PAD) + PAD + 4, 38), lab, fill=(170, 182, 196), font=f3)
    for r, row in enumerate(rows):
        y = HH + r * (th + PAD)
        d.text((10, y + th // 2 - 12), row["label"], fill=(235, 220, 160), font=f2)
        for c in range(len(cols)):
            x = LW + c * (tw + PAD) + PAD
            p = row["cells"][c] if c < len(row["cells"]) else None
            if p:
                try:
                    im = Image.open(p).convert("RGB").resize((tw, th), Image.LANCZOS)
                    sheet.paste(im, (x, y))
                    continue
                except Exception:
                    pass
            d.rectangle([x, y, x + tw, y + th], fill=(40, 42, 48))
    y = HH + len(rows) * (th + PAD) + 8
    for n in notes:
        d.text((10, y), n, fill=(150, 160, 172), font=f3)
        y += 22
    sheet.save(out)
    print(out)

if __name__ == "__main__":
    main()
