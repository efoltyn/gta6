#!/usr/bin/env python3
"""tools/storyboard-pdf.py — a storyboard as a PDF you read on a phone.

Usage: python3 tools/storyboard-pdf.py SPEC.json OUT.pdf

Pages are 1080 x 1920 (9:16, a phone held upright), dark, one idea a page,
every frame full width so it reads without zooming. SPEC:

  {"pages": [
    {"type": "cover",   "title", "subtitle", "image", "bullets": [..]},
    {"type": "section", "title", "kicker", "bullets": [..], "images": [path, ..]},
    {"type": "pair",    "title", "caption", "before", "after",
                        "beforeLabel"?, "afterLabel"?},
    {"type": "stack",   "title", "caption", "frames": [{"path", "label"}, ..]},   up to 3
    {"type": "sheet",   "title", "caption", "image"},    a whole contact sheet
    {"type": "text",    "title", "paragraphs": [..], "bullets": [..]}
  ]}

A page whose images are missing is skipped (and named on stderr), so a
partial render still makes a PDF. The frames come from tools/strike-look.mjs
(or any PNG/JPEG); contact sheets from tools/contact-sheet.py.
"""
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

W, H, M = 1080, 1920, 48
BG, FG, DIM, ACC, BEF, AFT = (15, 17, 21), (236, 238, 242), (150, 158, 170), (255, 196, 92), (232, 104, 92), (110, 210, 140)
FONT_DIRS = ["/usr/share/fonts/opentype/inter/", "/System/Library/Fonts/Supplemental/", "/Library/Fonts/"]


def font(name, size):
    for d in FONT_DIRS:
        for n in (name, "Arial Bold.ttf" if "Bold" in name or "Semi" in name else "Arial.ttf"):
            try:
                return ImageFont.truetype(os.path.join(d, n), size)
            except Exception:
                pass
    return ImageFont.load_default()


F = {
    "h0": font("Inter-Bold.otf", 76), "h1": font("Inter-Bold.otf", 52), "h2": font("Inter-SemiBold.otf", 36),
    "body": font("Inter-Regular.otf", 31), "small": font("Inter-Medium.otf", 26), "tag": font("Inter-Bold.otf", 26),
}


def wrap(d, text, f, width):
    out = []
    for para in str(text).split("\n"):
        words, line = para.split(" "), ""
        for w in words:
            t = (line + " " + w).strip()
            if d.textlength(t, font=f) <= width or not line:
                line = t
            else:
                out.append(line)
                line = w
        out.append(line)
    return out


def text(d, xy, s, f, fill, width, gap=8):
    x, y = xy
    for ln in wrap(d, s, f, width):
        d.text((x, y), ln, font=f, fill=fill)
        y += f.size + gap
    return y


def fit(path, width, max_h=None):
    im = Image.open(path).convert("RGB")
    k = width / im.width
    if max_h and im.height * k > max_h:
        k = max_h / im.height
    return im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))), Image.LANCZOS)


def tag(d, x, y, s, col):
    tw = d.textlength(s, font=F["tag"])
    d.rounded_rectangle([x, y, x + tw + 28, y + 42], radius=10, fill=col)
    d.text((x + 14, y + 6), s, font=F["tag"], fill=(12, 12, 14))


def header(d, p, y=M):
    if p.get("kicker"):
        d.text((M, y), p["kicker"].upper(), font=F["small"], fill=ACC)
        y += 40
    y = text(d, (M, y), p.get("title", ""), F["h1"], FG, W - 2 * M, 6) + 10
    if p.get("caption"):
        y = text(d, (M, y), p["caption"], F["body"], DIM, W - 2 * M) + 8
    return y + 14


def need(paths):
    miss = [q for q in paths if not q or not os.path.exists(q)]
    return miss


def page(p, num, total):
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)
    t = p["type"]
    if t == "cover":
        y = 120
        d.text((M, y), (p.get("kicker") or "STORYBOARDS").upper(), font=F["small"], fill=ACC)
        y = text(d, (M, y + 44), p["title"], F["h0"], FG, W - 2 * M, 10) + 16
        y = text(d, (M, y), p.get("subtitle", ""), F["h2"], DIM, W - 2 * M, 8) + 30
        if p.get("image"):
            fr = fit(p["image"], W - 2 * M)
            im.paste(fr, (M, y)); y += fr.height + 34
        for b in p.get("bullets", []):
            d.ellipse([M, y + 12, M + 12, y + 24], fill=ACC)
            y = text(d, (M + 30, y), b, F["body"], FG, W - 2 * M - 30) + 10
    elif t == "section":
        y = header(d, p, 90)
        for b in p.get("bullets", []):
            d.ellipse([M, y + 12, M + 12, y + 24], fill=ACC)
            y = text(d, (M + 30, y), b, F["body"], FG, W - 2 * M - 30) + 12
        y += 16
        for q in p.get("images", []):
            fr = fit(q, W - 2 * M, H - y - 90)
            if y + fr.height > H - 80:
                break
            im.paste(fr, (M, y)); y += fr.height + 20
    elif t == "pair":
        y = header(d, p)
        room = (H - y - 90 - 2 * 60) // 2
        for key, lab, col in (("before", p.get("beforeLabel", "BEFORE"), BEF), ("after", p.get("afterLabel", "AFTER"), AFT)):
            tag(d, M, y, lab, col)
            y += 56
            fr = fit(p[key], W - 2 * M, room)
            im.paste(fr, (M, y)); y += fr.height + 26
    elif t == "stack":
        y = header(d, p)
        fs = p["frames"][:3]
        room = (H - y - 90 - len(fs) * 52) // max(1, len(fs))
        for f in fs:
            if f.get("label"):
                d.text((M, y), f["label"], font=F["h2"], fill=ACC)
                y += 48
            fr = fit(f["path"], W - 2 * M, room)
            im.paste(fr, (M, y)); y += fr.height + 22
    elif t == "sheet":
        y = header(d, p)
        fr = fit(p["image"], W - 2 * M, H - y - 90)
        im.paste(fr, (M + (W - 2 * M - fr.width) // 2, y))
    elif t == "text":
        y = header(d, p, 90)
        for para in p.get("paragraphs", []):
            y = text(d, (M, y), para, F["body"], FG, W - 2 * M) + 18
        for b in p.get("bullets", []):
            d.ellipse([M, y + 12, M + 12, y + 24], fill=ACC)
            y = text(d, (M + 30, y), b, F["body"], FG, W - 2 * M - 30) + 10
            if y > H - 120:
                break
    d.text((M, H - 58), p.get("foot", ""), font=F["small"], fill=DIM)
    s = "%d / %d" % (num, total)
    d.text((W - M - d.textlength(s, font=F["small"]), H - 58), s, font=F["small"], fill=DIM)
    return im


def main():
    spec = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    pages = []
    for p in spec["pages"]:
        paths = [p.get("image"), p.get("before"), p.get("after")] if p["type"] in ("pair", "sheet") else []
        if p["type"] == "pair":
            paths = [p.get("before"), p.get("after")]
        elif p["type"] == "sheet":
            paths = [p.get("image")]
        elif p["type"] == "stack":
            paths = [f.get("path") for f in p.get("frames", [])]
        elif p["type"] in ("section", "cover"):
            paths = (p.get("images") or []) + ([p["image"]] if p.get("image") else [])
        miss = need(paths)
        if miss:
            print("skip page '%s': missing %s" % (p.get("title", p["type"]), ", ".join(str(m) for m in miss)), file=sys.stderr)
            continue
        pages.append(p)
    imgs = [page(p, i + 1, len(pages)) for i, p in enumerate(pages)]
    if not imgs:
        sys.exit("no pages")
    imgs[0].save(out, "PDF", save_all=True, append_images=imgs[1:], resolution=160.0, quality=86)
    print("%s  (%d pages, %.1f MB)" % (out, len(imgs), os.path.getsize(out) / 1e6))


if __name__ == "__main__":
    main()
