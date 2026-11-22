"""tools/citymap/zoom.py: draw one piece of the world from map.json at street scale.

  python3 tools/citymap/zoom.py x0 z0 x1 z1 [metres per pixel, default 1] [out.png]

map-full.png is drawn at 6 m a pixel, where a street is two pixels and a lot
is a smudge. This draws a window straight from the records at any scale:
water and land from the 40 m grid, road records (grey), highway decks (gold),
metro streets, every planned building, every standing collider (dark), the
downtown lots (outlined), registered places (outlined, named) and the venues
(magenta dots, named: game packages, shop lots, the motel, the law's desk,
the spawn, the gas stations). Reads CITYMAP_OUT like render.py."""
import json, os, sys, math
from PIL import Image, ImageDraw, ImageFont

G = os.environ.get('CITYMAP_OUT', '/Users/elifoltyn/harness/out/gta6/citymap/')
o = json.load(open(G + 'map.json'))
x0, z0, x1, z1 = [float(v) for v in sys.argv[1:5]]
S = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
out = sys.argv[6] if len(sys.argv) > 6 else G + 'zoom.png'
W, H = int((x1 - x0) / S), int((z1 - z0) / S)
im = Image.new('RGB', (W, H), (205, 214, 180))
d = ImageDraw.Draw(im, 'RGBA')
def P(x, z): return ((x - x0) / S, (z - z0) / S)
def font(px):
    try: return ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', max(8, int(px)))
    except Exception: return ImageFont.load_default()
F = font(11)

g = o['grid']; B = o['bounds']; st = g['step']; nx = g['nx']
LAND = {'desert': (232, 206, 150), 'forest': (128, 172, 122), 'farmland': (222, 218, 132), 'snow': (240, 244, 250)}
for j in range(g['nz']):
    zc = B['minZ'] + j * st
    if zc + st < z0 or zc > z1: continue
    for i in range(nx):
        xc = B['minX'] + i * st
        if xc + st < x0 or xc > x1: continue
        k = j * nx + i; w = g['W'][k]
        col = (112, 162, 208) if w == 1 else ((126, 182, 222) if w == 2 else LAND.get(g['biomes'][g['B'][k]], (205, 214, 180)))
        a, b = P(xc, zc), P(xc + st, zc + st)
        d.rectangle([a[0], a[1], b[0], b[1]], fill=col)
for r in o['regions']:
    if r.get('x0') is None: continue
    a, b = P(r['x0'], r['z0']), P(r['x1'], r['z1'])
    if b[0] < 0 or b[1] < 0 or a[0] > W or a[1] > H: continue
    d.rectangle([a[0], a[1], b[0], b[1]], outline=(90, 80, 70, 160))
for r in o['roads']:
    hw, hl = max(1, r['w'] / 2), r['len'] / 2
    rc = (r['x'] - hw, r['z'] - hl, r['x'] + hw, r['z'] + hl) if r['v'] else (r['x'] - hl, r['z'] - hw, r['x'] + hl, r['z'] + hw)
    a, b = P(rc[0], rc[1]), P(rc[2], rc[3])
    d.rectangle([a[0], a[1], b[0], b[1]], fill=(150, 146, 140, 200) if not r.get('rural') else (170, 150, 118, 220))
for h in o['highways']:
    p = [P(q[0], q[1]) for q in h['pts']]
    if len(p) > 1: d.line(p, fill=(250, 196, 50, 230), width=max(1, int((h.get('w') or 24) / S)))
for M in o.get('metros', []):
    for s in M['st']:
        p = [P(q[0], q[1]) for q in s['p']]
        if len(p) > 1: d.line(p, fill=(140, 136, 130, 255), width=max(1, int(s['w'] / S)))
    for b in M['b']:
        c, s_ = math.cos(b[4]), math.sin(b[4]); hw, hd = b[2] / 2, b[3] / 2
        pts = [P(b[0] + lx * c + lz * s_, b[1] - lx * s_ + lz * c) for lx, lz in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
        d.polygon(pts, fill=(176, 96, 62, 255) if b[7] == 0 else (255, 0, 200, 255))
for l in o.get('lots', []):
    a, b = P(l['x'] - l['w'] / 2, l['z'] - l['d'] / 2), P(l['x'] + l['w'] / 2, l['z'] + l['d'] / 2)
    if b[0] < 0 or b[1] < 0 or a[0] > W or a[1] > H: continue
    d.rectangle([a[0], a[1], b[0], b[1]], outline=(60, 60, 160, 200))
for f in o['foot']:
    a, b = P(f[0], f[1]), P(f[2], f[3])
    if b[0] < 0 or b[1] < 0 or a[0] > W or a[1] > H: continue
    d.rectangle([a[0], a[1], b[0], b[1]], fill=(60, 60, 64, 200) if not f[5] else (255, 0, 200, 255))
for r in o['regions']:
    if r.get('x0') is None or r.get('road'): continue
    a = P((r['x0'] + r['x1']) / 2, r['z0'])
    if 0 <= a[0] <= W and 0 <= a[1] <= H: d.text((a[0] + 2, a[1] + 2), r['n'] or '', font=F, fill=(40, 30, 20, 255))
for v in o.get('venues', []):
    a = P(v['x'], v['z'])
    if not (0 <= a[0] <= W and 0 <= a[1] <= H): continue
    if v.get('w'):
        q, r2 = P(v['x'] - v['w'] / 2, v['z'] - v['d'] / 2), P(v['x'] + v['w'] / 2, v['z'] + v['d'] / 2)
        d.rectangle([q[0], q[1], r2[0], r2[1]], outline=(255, 0, 200, 255), width=2)
    d.ellipse([a[0] - 4, a[1] - 4, a[0] + 4, a[1] + 4], fill=(255, 0, 200, 255) if not v.get('wet') else (0, 0, 255, 255))
    d.text((a[0] + 6, a[1] - 6), v['id'] + ((' ' + v['n']) if v.get('n') else ''), font=F, fill=(120, 0, 90, 255), stroke_width=2, stroke_fill=(255, 255, 255, 220))
# a scale bar and the corner coordinates
d.rectangle([8, H - 22, 8 + 100 / S, H - 16], fill=(0, 0, 0, 255)); d.text((12 + 100 / S, H - 26), '100 m', font=F, fill=(0, 0, 0, 255))
d.text((6, 6), '(%d, %d)' % (x0, z0), font=F, fill=(0, 0, 0, 255))
im.save(out)
print(out, im.size)
