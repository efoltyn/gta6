#!/usr/bin/env node
/* ============================================================
   tools/ios-art.mjs — bake the App Store icon + launch image.

   `npx cap add ios` ships Capacitor's own placeholder art: a blue Capacitor
   logo on the icon and on the splash. Shipping those is not a style choice,
   it is a rejection — App Store Review reads a template icon as an incomplete
   app, and it is the first thing a reviewer sees.

   This draws both from the game's OWN mark: the skyline glyph already in
   index.html's favicon (a low block and a tall one, #ffd451 on #111923),
   which is the only piece of brand this project has. The tall block gets the
   thing the favicon could not fit at 64px — BARS, three of them, cut straight
   through it. Read at 40pt on a home screen it is a yellow skyline; read at
   1024 it is a cell window. That is the game.

   Deliberately NO TEXT. Apple's own guidance, and the practical reason: this
   icon has to survive being 40 points wide, where any word turns to mush.

       node tools/ios-art.mjs

   Writes ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
   (the single 1024 marketing icon Xcode 14+ wants — it derives every other
   size) and the three 2732px launch images the generated LaunchScreen
   storyboard references. Re-run after changing the palette below.

   Requires Pillow (pip install pillow). The drawing itself is a few dozen
   rectangles, so it is done in Python rather than by rendering a page in a
   browser — one less moving part, and byte-identical every run.
============================================================ */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ICONSET = join(ROOT, "ios/App/App/Assets.xcassets/AppIcon.appiconset");
const SPLASHSET = join(ROOT, "ios/App/App/Assets.xcassets/Splash.imageset");

const PY = `
import os, sys
from PIL import Image, ImageDraw, ImageFilter

ICONSET   = ${JSON.stringify(ICONSET)}
SPLASHSET = ${JSON.stringify(SPLASHSET)}

# css/base.css's page ground, and the favicon's yellow. Nothing invented.
IN_K   = (11, 22, 34)      # #0b1622
DEEP   = (22, 39, 58)      # lifted top of the gradient
GOLD   = (255, 212, 81)    # #ffd451
GOLD_D = (214, 168, 44)    # the shaded face of the near block

def ground(size, top, bottom):
    """Vertical gradient. iOS icons must be fully opaque - no alpha, ever."""
    img = Image.new("RGB", (size, size), bottom)
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / max(1, size - 1)
        d.line([(0, y), (size, y)],
               fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return img

def skyline(img, cx, cy, unit, bars=True):
    """The favicon's two blocks, drawn at 'unit' pixels per SVG unit.

    Source path, on a 64 viewBox:  M12 48V28h12v20z   (low block)
                                   m16 0V12h24v36z    (tall block)
    Same proportions, centred on (cx, cy) rather than on the viewBox origin.
    """
    d = ImageDraw.Draw(img)
    def box(x0, y0, x1, y1, fill):
        d.rectangle([cx + (x0 - 32) * unit, cy + (y0 - 30) * unit,
                     cx + (x1 - 32) * unit, cy + (y1 - 30) * unit], fill=fill)
    box(12, 28, 24, 48, GOLD_D)          # low block, shaded - it reads as nearer
    box(28, 12, 52, 48, GOLD)            # tall block
    if bars:
        # THREE BARS through the tall block, in the ground colour, stopping
        # short of the base so the block still reads as solid at thumbnail size.
        for i in range(3):
            x = 33.0 + i * 6.4
            box(x, 19, x + 2.6, 44, IN_K)

def icon(size, path):
    base = ground(size, DEEP, IN_K)
    u = (size / 64.0) * 0.86

    # A soft floor glow under the skyline, so the mark stands IN the scene
    # rather than on it. Blurred ellipse, added (not blended) into the lower
    # half only, at a fifth strength - enough to read as light off a yard.
    glow = Image.new("RGB", (size, size), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [size * 0.16, size * 0.64, size * 0.84, size * 0.88], fill=(52, 80, 112))
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.055))
    px, gx = base.load(), glow.load()
    for y in range(int(size * 0.52), size):
        for x in range(size):
            b, g = px[x, y], gx[x, y]
            px[x, y] = (min(255, b[0] + g[0] // 5), min(255, b[1] + g[1] // 5), min(255, b[2] + g[2] // 5))

    skyline(base, size * 0.5, size * 0.5, u)   # over the glow, never under it
    base.save(path, "PNG")
    print("  " + os.path.basename(path) + "  " + str(size) + "x" + str(size))

def splash(size, path):
    """Square, because LaunchScreen.storyboard scaleAspectFills it into any
    orientation on any device. Small mark, lots of ground - it is on screen
    for a heartbeat before the world starts building."""
    img = ground(size, DEEP, IN_K)
    skyline(img, size * 0.5, size * 0.5, (size / 64.0) * 0.30)
    img.save(path, "PNG")
    print("  " + os.path.basename(path) + "  " + str(size) + "x" + str(size))

print("app icon:")
icon(1024, os.path.join(ICONSET, "AppIcon-512@2x.png"))
print("launch image:")
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    splash(2732, os.path.join(SPLASHSET, name))
`;

const r = spawnSync("python3", ["-c", PY], { stdio: "inherit" });
process.exit(r.status ?? 1);
