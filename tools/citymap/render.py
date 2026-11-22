"""tools/citymap/render.py: draw the Gang City map from map.json (tools/citymap/dump.mjs).

  python3 tools/citymap/render.py [metres per pixel, default 6]

Writes into CITYMAP_OUT (default ~/harness/out/gta6/citymap/):
  map-full.png      the whole world at the asked scale, problems marked
  map-small.jpg     the whole world 1500 px wide, lettered for that size
  map-problems.jpg  the small map greyed, with only the problems on it
  problems.txt      every problem as a line: kind, x, z, what
  problems.json     the same as data

THE PROBLEMS LAYER (magenta on the map) is measured here from the records, not
read from the systems that made them:
  WATER   a building footprint, a lot, or a road with no deck under it, in water
  HWY     a home within 70 m of a highway carriageway edge
  OVERLAP two places whose registered ground overlaps
  DEADEND a road end that touches no other road and stands in no place
  NOROAD  a place no road reaches, or whose roads do not join the main network
  SPAWN   the player started in water or outside the downtown
"""
import json, sys, math, os
from collections import defaultdict
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

G = os.environ.get('CITYMAP_OUT', '/Users/elifoltyn/harness/out/gta6/citymap/')
o = json.load(open(G + 'map.json'))
B = o['bounds']
S_FULL = float(sys.argv[1]) if len(sys.argv) > 1 else 6.0
g = o['grid']; nx, nz, st = g['nx'], g['nz'], g['step']
Hh = np.array(g['H'], dtype=np.float32).reshape(nz, nx)
Wt = np.array(g['W'], dtype=np.uint8).reshape(nz, nx)
Bi = np.array(g.get('B') or [0] * (nx * nz), dtype=np.int16).reshape(nz, nx)
biomes = g.get('biomes') or ['city']

NATURAL = {'desert', 'forest', 'farmland', 'snow', 'wilds'}
LAND = {  # land cover as the game classifies the ground (cityBiomeAt), not region rectangles
    'wilds': (200, 214, 172), 'forest': (128, 172, 122), 'desert': (232, 206, 150), 'farmland': (222, 218, 132),
    'snow': (240, 244, 250), 'airport': (196, 198, 204), 'military': (176, 186, 150), 'speedway': (206, 190, 186),
    'arena': (206, 190, 186), 'annex': (222, 214, 200), 'city': (222, 214, 200),
}
URBAN = (224, 216, 202)
SEA, SEA_DEEP, INLAND = (112, 162, 208), (84, 134, 190), (126, 182, 222)
MAGENTA = (255, 0, 200)

FONT_DIR = '/System/Library/Fonts/Supplemental/'
def font(name, px):
    try: return ImageFont.truetype(FONT_DIR + name, max(7, int(px)))
    except Exception: return ImageFont.load_default()

# ------------------------------------------------------------------ helpers
def rect_of(r):
    if r.get('k') == 'circle' and r.get('r'):
        return (r['cx'] - r['r'], r['cz'] - r['r'], r['cx'] + r['r'], r['cz'] + r['r'])
    if r.get('x0') is None: return None
    return (r['x0'], r['z0'], r['x1'], r['z1'])
ROADISH = ('bridge', 'causeway', ' link', 'approach', 'spur', 'connector', 'ramp')
def is_roadish(r):
    n = (r.get('n') or '').lower()
    return bool(r.get('road')) or any(k in n for k in ROADISH)
def road_rect(r, grow=0.0):
    hw = max(1.0, r['w'] / 2) + grow; hl = r['len'] / 2 + grow
    return (r['x'] - hw, r['z'] - hl, r['x'] + hw, r['z'] + hl) if r['v'] else (r['x'] - hl, r['z'] - hw, r['x'] + hl, r['z'] + hw)
def road_ends(r):
    hl = r['len'] / 2
    return [(r['x'], r['z'] - hl), (r['x'], r['z'] + hl)] if r['v'] else [(r['x'] - hl, r['z']), (r['x'] + hl, r['z'])]
def rects_hit(a, b): return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]
def pt_in(p, a, pad=0.0): return a[0] - pad <= p[0] <= a[2] + pad and a[1] - pad <= p[1] <= a[3] + pad
def seg_dist(px, pz, ax, az, bx, bz):
    vx, vz = bx - ax, bz - az; L2 = vx * vx + vz * vz
    t = 0 if L2 <= 0 else max(0.0, min(1.0, ((px - ax) * vx + (pz - az) * vz) / L2))
    return math.hypot(px - (ax + vx * t), pz - (az + vz * t))
class Buckets:
    """items filed by the 250 m cells their rect touches"""
    def __init__(self, cell=250): self.c = cell; self.m = defaultdict(list)
    def add(self, rect, item):
        c = self.c
        for i in range(int(rect[0] // c), int(rect[2] // c) + 1):
            for j in range(int(rect[1] // c), int(rect[3] // c) + 1): self.m[(i, j)].append(item)
    def near(self, rect):
        c = self.c; seen = set(); out = []
        for i in range(int(rect[0] // c), int(rect[2] // c) + 1):
            for j in range(int(rect[1] // c), int(rect[3] // c) + 1):
                for it in self.m.get((i, j), ()):
                    if id(it) not in seen: seen.add(id(it)); out.append(it)
        return out

regions = o['regions']
roads = o['roads']
types = o.get('types') or []
HOME_T = {i for i, t in enumerate(types) if t in ('house', 'row', 'apt', 'mainstreet', 'farmhouse', 'cabin', 'home', 'trailer')}

# places: registered ground that is somewhere, grouped by name
places = {}
for r in regions:
    rc = rect_of(r)
    if rc is None or r.get('under') or is_roadish(r) or (r.get('b') == 'wilds'): continue
    n = r.get('n') or r.get('b') or '?'
    p = places.setdefault(n, {'n': n, 'b': r.get('b'), 'rects': [], 'metro': 0, 'lab': 1})
    p['rects'].append(rc); p['metro'] |= r.get('metro', 0); p['lab'] &= (1 if r.get('metro') else r.get('lab', 1))
for p in places.values():
    xs0 = min(a[0] for a in p['rects']); zs0 = min(a[1] for a in p['rects'])
    xs1 = max(a[2] for a in p['rects']); zs1 = max(a[3] for a in p['rects'])
    p['box'] = (xs0, zs0, xs1, zs1)
    p['area'] = sum((a[2] - a[0]) * (a[3] - a[1]) for a in p['rects'])
    # the label sits on the biggest piece, not on the middle of a ragged union
    big = max(p['rects'], key=lambda a: (a[2] - a[0]) * (a[3] - a[1]))
    p['at'] = ((xs0 + xs1) / 2, (zs0 + zs1) / 2) if len(p['rects']) > 6 else ((big[0] + big[2]) / 2, (big[1] + big[3]) / 2)

# ------------------------------------------------------------------ PROBLEMS
problems = []
def flag(kind, x, z, what): problems.append({'kind': kind, 'x': round(x), 'z': round(z), 'what': what})

# WATER: buildings, lots, roads
for M in o.get('metros', []):
    nwet = 0
    for b in M['b']:
        if b[7]:
            nwet += 1
            if nwet <= 400: flag('WATER', b[0], b[1], 'planned building (%s) of %s stands in water' % (types[b[6]] if b[6] < len(types) else '?', M['n']))
    for s in M['st']:
        if s.get('wet') and not s.get('el'):
            a = s['p'][len(s['p']) // 2]; flag('WATER', a[0], a[1], '%s street (%s) crosses open water with no deck' % (M['n'], s.get('k')))
MAR = o.get('marina')
for f in o['foot']:
    # the marina's own sheds stand on its quay and pontoons, over the water by design
    if MAR and MAR['x0'] <= (f[0] + f[2]) / 2 <= MAR['x1'] and MAR['z0'] <= (f[1] + f[3]) / 2 <= MAR['z1']: continue
    # a wall, a rail or a quay edge is not a building: only real footprints
    if f[5] and not f[6] and min(f[2] - f[0], f[3] - f[1]) >= 3: flag('WATER', (f[0] + f[2]) / 2, (f[1] + f[3]) / 2, 'standing structure %dx%d m in water%s' % (f[2] - f[0], f[3] - f[1], (' (' + f[7] + ')') if len(f) > 7 and f[7] else ''))
for l in o.get('lots', []):
    if l.get('wet'): flag('WATER', l['x'], l['z'], 'lot (%s) in water' % l.get('k'))
seen_rw = set()
for q in o.get('roadWet', []):
    if (q[3] if len(q) > 3 else 1) != 1: continue
    key = (q[2], q[0] // 120, q[1] // 120)
    if key in seen_rw: continue
    seen_rw.add(key); r = roads[q[2]]
    flag('WATER', q[0], q[1], 'road record (%s) over open water with no deck' % (r.get('rt') or r.get('d') or r.get('n') or 'road'))
for h in o['highways']:
    last = None
    for q in h.get('wet', []):
        if q[2] != 1: continue
        if last and math.hypot(q[0] - last[0], q[1] - last[1]) < 150: continue
        last = q; flag('WATER', q[0], q[1], 'highway deck (%s) over open water with no bridge' % (h.get('n') or h.get('rt') or '?'))

# HWY: homes within 70 m of a highway carriageway edge
hw_lines = []
for h in o['net']:
    if not h.get('rural') and len(h['pts']) > 1: hw_lines.append((h['pts'], (h.get('w') or 30.6) / 2, h.get('n') or h.get('id')))
for h in o['highways']:
    # a causeway deck built by a place's own file: a highway when it is a 3+3 paved one
    if (h.get('w') or 0) >= 20 and (h.get('lanes') or 3) >= 3 and h.get('theme') != 'dirt' and len(h['pts']) > 1 and not h.get('rt'): hw_lines.append((h['pts'], h['w'] / 2, h.get('n') or 'causeway'))
hw_b = Buckets(250)
for pts, half, name in hw_lines:
    for i in range(len(pts) - 1):
        a, b2 = pts[i], pts[i + 1]
        hw_b.add((min(a[0], b2[0]) - 110, min(a[1], b2[1]) - 110, max(a[0], b2[0]) + 110, max(a[1], b2[1]) + 110), (a, b2, half, name))
n_hwy = 0
for M in o.get('metros', []):
    for b in M['b']:
        if b[6] not in HOME_T: continue
        rad = max(b[2], b[3]) / 2
        for (a, b2, half, name) in hw_b.near((b[0], b[1], b[0], b[1])):
            d = seg_dist(b[0], b[1], a[0], a[1], b2[0], b2[1]) - half - rad
            if d < 70:
                n_hwy += 1
                if n_hwy <= 600: flag('HWY', b[0], b[1], 'home (%s, %s) %d m from %s' % (types[b[6]], M['n'], max(0, d), name))
                break

# OVERLAP: two places claiming the same ground
pl = [p for p in places.values()]
for i in range(len(pl)):
    for j in range(i + 1, len(pl)):
        a, b2 = pl[i], pl[j]
        if not rects_hit(a['box'], b2['box']): continue
        if a['b'] and a['b'] == b2['b']: continue          # one owner, several pieces
        area = 0.0; at = None
        for ra in a['rects']:
            for rb in b2['rects']:
                w = min(ra[2], rb[2]) - max(ra[0], rb[0]); d = min(ra[3], rb[3]) - max(ra[1], rb[1])
                if w > 4 and d > 4:
                    area += w * d
                    if at is None: at = ((max(ra[0], rb[0]) + min(ra[2], rb[2])) / 2, (max(ra[1], rb[1]) + min(ra[3], rb[3])) / 2)
        small = min(a['area'], b2['area'])
        # a small place standing wholly inside a biome or a city is in it, not on top of it
        nat_a, nat_b = a['b'] in NATURAL or a['metro'], b2['b'] in NATURAL or b2['metro']
        if area > 400 and not ((nat_a or nat_b) and area >= 0.9 * small):
            flag('OVERLAP', at[0], at[1], '%s x %s share %d m2' % (a['n'], b2['n'], area))

# road graph: records + metro through-streets, joined where they touch
class DSU:
    def __init__(s, n): s.p = list(range(n))
    def f(s, a):
        while s.p[a] != a: s.p[a] = s.p[s.p[a]]; a = s.p[a]
        return a
    def u(s, a, b): s.p[s.f(a)] = s.f(b)
segs = []          # (rect, kind, label)
for i, r in enumerate(roads): segs.append((road_rect(r, 0), 'rec', i))
for mi, M in enumerate(o.get('metros', [])):
    for si, s in enumerate(M['st']):
        p = s['p']; hw2 = s['w'] / 2
        segs.append(((min(q[0] for q in p) - hw2, min(q[1] for q in p) - hw2, max(q[0] for q in p) + hw2, max(q[1] for q in p) + hw2), 'st', (mi, si)))
JOIN = 14.0        # vehicles.js hops a junction inside ~9 m; decks stop flush at an edge
seg_b = Buckets(250)
for k, sg in enumerate(segs): seg_b.add((sg[0][0] - JOIN, sg[0][1] - JOIN, sg[0][2] + JOIN, sg[0][3] + JOIN), k)
dsu = DSU(len(segs))
def seg_touch(k, m):
    a, b2 = segs[k], segs[m]
    ra = (a[0][0] - JOIN, a[0][1] - JOIN, a[0][2] + JOIN, a[0][3] + JOIN)
    if not rects_hit(ra, b2[0]): return False
    if a[1] == 'rec' and b2[1] == 'rec': return True
    # a metro street is a polyline: test its real segments against the other's rect
    def poly_hits(sg, rc):
        if sg[1] == 'rec': return True
        M = o['metros'][sg[2][0]]; s = M['st'][sg[2][1]]; hw2 = s['w'] / 2 + JOIN
        cx, cz = (rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2; ex, ez = (rc[2] - rc[0]) / 2, (rc[3] - rc[1]) / 2
        p = s['p']
        for i in range(len(p) - 1):
            # distance from the rect to the segment, by sampling the segment
            L = math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); n = max(1, int(L / 10))
            for t in range(n + 1):
                x = p[i][0] + (p[i + 1][0] - p[i][0]) * t / n; z = p[i][1] + (p[i + 1][1] - p[i][1]) * t / n
                if abs(x - cx) <= ex + hw2 and abs(z - cz) <= ez + hw2: return True
        return False
    return poly_hits(a, b2[0]) and poly_hits(b2, a[0])
for k in range(len(segs)):
    sg = segs[k]
    for m in seg_b.near(sg[0]):
        if m > k and seg_touch(k, m): dsu.u(k, m)
# the main network is the component holding the most road length
comp_len = defaultdict(float)
for k, sg in enumerate(segs): comp_len[dsu.f(k)] += max(sg[0][2] - sg[0][0], sg[0][3] - sg[0][1])
main = max(comp_len, key=comp_len.get) if comp_len else None
place_b = Buckets(250)
for p in places.values():
    for rc in p['rects']: place_b.add(rc, (rc, p))
cityrc = (o['city']['minX'], o['city']['minZ'], o['city']['maxX'], o['city']['maxZ']) if o.get('city') and o['city'].get('minX') is not None else None

# DEADEND: a road-record end touching nothing and standing nowhere
rec_b = Buckets(250)
for i, r in enumerate(roads): rec_b.add(road_rect(r, JOIN), i)
st_b = Buckets(250)
for k, sg in enumerate(segs):
    if sg[1] == 'st': st_b.add(sg[0], k)
for i, r in enumerate(roads):
    if r['len'] < 30: continue
    for e in road_ends(r):
        ok = False
        for j in rec_b.near((e[0], e[1], e[0], e[1])):
            if j != i and pt_in(e, road_rect(roads[j], JOIN)): ok = True; break
        if not ok:
            for k in st_b.near((e[0] - JOIN, e[1] - JOIN, e[0] + JOIN, e[1] + JOIN)):
                if pt_in(e, segs[k][0], JOIN): ok = True; break
        if not ok and cityrc and pt_in(e, cityrc, 60): ok = True
        if not ok:
            for (rc, p) in place_b.near((e[0], e[1], e[0], e[1])):
                if pt_in(e, rc, 25): ok = True; break
        if not ok and o.get('annex') and math.hypot(e[0] - o['annex']['cx'], e[1] - o['annex']['cz']) < o['annex']['r'] + 30: ok = True
        if not ok:      # a venue registered as an underlay circle (the speedway) is still somewhere
            for r2 in regions:
                if r2.get('under') and r2.get('b') != 'wilds' and r2.get('k') == 'circle' and r2.get('r') and math.hypot(e[0] - r2['cx'], e[1] - r2['cz']) < r2['r'] + 10: ok = True; break
        if not ok: flag('DEADEND', e[0], e[1], 'road (%s) ends in nothing' % (r.get('rt') or r.get('d') or r.get('n') or 'road'))

# NOROAD: a place no road reaches, or whose roads are cut off from the main network
for p in places.values():
    if p['b'] in ('desert', 'forest', 'farmland', 'snow'): continue
    if (p['box'][2] - p['box'][0]) < 60 and (p['box'][3] - p['box'][1]) < 60: continue      # a hut, a relay mast
    reach = False; joined = False
    for rc in p['rects']:
        grown = (rc[0] - 30, rc[1] - 30, rc[2] + 30, rc[3] + 30)
        for k in seg_b.near(grown):
            if rects_hit(grown, segs[k][0]):
                reach = True
                if dsu.f(k) == dsu.f(main): joined = True; break
        if joined: break
    if not reach: flag('NOROAD', p['at'][0], p['at'][1], '%s: no road reaches it' % p['n'])
    elif not joined: flag('NOROAD', p['at'][0], p['at'][1], '%s: its roads do not join the main network' % p['n'])

# SPAWN
sp = o.get('spawn')
if sp and sp.get('x') is not None:
    if o.get('spawnWet'): flag('SPAWN', sp['x'], sp['z'], 'the player starts in water')
    if cityrc and not pt_in((sp['x'], sp['z']), cityrc, 40): flag('SPAWN', sp['x'], sp['z'], 'the player starts outside the downtown (%d, %d)' % (sp['x'], sp['z']))

counts = defaultdict(int)
for p in problems: counts[p['kind']] += 1
with open(G + 'problems.txt', 'w') as f:
    f.write('PROBLEMS  ' + '  '.join('%s %d' % (k, counts[k]) for k in ('WATER', 'HWY', 'OVERLAP', 'DEADEND', 'NOROAD', 'SPAWN')) + '\n')
    if n_hwy > 600: f.write('(HWY: %d homes in all, first 600 listed)\n' % n_hwy)
    f.write('whole world built: %s\n' % ('no, streamed boot: far places are manifest replays' if o.get('streamed') else 'yes'))
    for p in sorted(problems, key=lambda p: (p['kind'], p['x'], p['z'])): f.write('%-8s %7d %7d  %s\n' % (p['kind'], p['x'], p['z'], p['what']))
json.dump({'counts': counts, 'problems': problems}, open(G + 'problems.json', 'w'))

# ------------------------------------------------------------------ DRAWING
def base_image(S):
    Wp = int((B['maxX'] - B['minX']) / S); Hp = int((B['maxZ'] - B['minZ']) / S)
    # land cover per grid cell, then hillshade, then water
    rgb = np.zeros((nz, nx, 3), dtype=np.float32)
    for i, b in enumerate(biomes):
        rgb[Bi == i] = LAND.get(b, URBAN)
    h = Hh
    # height tint: uplands go drier and browner, the high ground rock then snow
    t = np.clip(h / 110.0, 0, 1)[..., None]
    rock = np.array([186, 176, 150], dtype=np.float32)
    nat = np.isin(Bi, [i for i, b in enumerate(biomes) if b in ('wilds', 'forest', 'farmland')])[..., None]
    rgb = np.where(nat, rgb * (1 - 0.55 * t) + rock * (0.55 * t), rgb)
    snow = np.clip((h - 150) / 60.0, 0, 1)[..., None]
    rgb = rgb * (1 - snow) + np.array([244, 246, 250], dtype=np.float32) * snow
    gx = np.zeros_like(h); gz = np.zeros_like(h)
    gx[:, 1:] = h[:, 1:] - h[:, :-1]; gz[1:, :] = h[1:, :] - h[:-1, :]
    shade = np.clip((gx + gz) / (st * 0.35), -1, 1)[..., None]
    rgb = np.clip(rgb * (1 + 0.22 * shade), 0, 255)
    land = Image.fromarray(rgb.astype(np.uint8), 'RGB').resize((Wp, Hp), Image.BICUBIC)
    # water: a crisp mask upsampled smooth, sea darker away from land
    wm = Image.fromarray(((Wt > 0) * 255).astype(np.uint8), 'L').resize((Wp, Hp), Image.BICUBIC).point(lambda v: 255 if v > 127 else 0)
    inl = Image.fromarray(((Wt == 2) * 255).astype(np.uint8), 'L').resize((Wp, Hp), Image.BICUBIC).point(lambda v: 255 if v > 127 else 0)
    far = Image.fromarray(((Wt > 0) * 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(9)).resize((Wp, Hp), Image.BICUBIC)
    sea = Image.composite(Image.new('RGB', (Wp, Hp), SEA_DEEP), Image.new('RGB', (Wp, Hp), SEA), far.point(lambda v: max(0, min(255, (v - 150) * 3))))
    sea = Image.composite(Image.new('RGB', (Wp, Hp), INLAND), sea, inl)
    im = Image.composite(sea, land, wm)
    # coastline
    edge = wm.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 40 else 0)
    im = Image.composite(Image.new('RGB', (Wp, Hp), (52, 86, 122)), im, edge)
    return im, Wp, Hp

def draw_map(S, problems_only=False):
    im, Wp, Hp = base_image(S)
    if problems_only:
        im = Image.blend(im.convert('L').convert('RGB'), Image.new('RGB', im.size, (255, 255, 255)), 0.35)
    d = ImageDraw.Draw(im, 'RGBA')
    def px(x, z): return ((x - B['minX']) / S, (z - B['minZ']) / S)
    def lw(m, floor=1): return max(floor, int(round(m / S)))
    if not problems_only:
        # metro ground, parks, streets, buildings
        for r in regions:
            rc = rect_of(r)
            if rc is None or not r.get('metro') or is_roadish(r): continue
            a = px(rc[0], rc[1]); b = px(rc[2], rc[3]); d.rectangle([a[0], a[1], b[0], b[1]], fill=URBAN + (150,))
        for M in o.get('metros', []):
            for k in M['pk']:
                a = px(k[0], k[1]); b = px(k[2], k[3]); d.rectangle([a[0], a[1], b[0], b[1]], fill=(150, 196, 132, 255))
        for M in o.get('metros', []):
            for s in M['st']:
                p = [px(q[0], q[1]) for q in s['p']]
                k = s.get('k') or ''
                col = (120, 118, 116, 255) if k in ('art', 'ave', 'arterial', 'spoke') else ((150, 148, 144, 255) if k != 'rural' else (170, 150, 118, 255))
                d.line(p, fill=col, width=lw(s['w'], 1))
        # places: an outline says whose ground it is; natural biomes are drawn by the ground itself
        for r in regions:
            rc = rect_of(r)
            if rc is None or r.get('under') or is_roadish(r) or r.get('metro') or r.get('b') in NATURAL: continue
            a = px(rc[0], rc[1]); b = px(rc[2], rc[3])
            if r.get('k') == 'circle': d.ellipse([a[0], a[1], b[0], b[1]], outline=(90, 80, 70, 200))
            else: d.rectangle([a[0], a[1], b[0], b[1]], outline=(90, 80, 70, 200))
        # road records
        for r in roads:
            if r.get('d') == 'highway': continue
            rc = road_rect(r); a = px(rc[0], rc[1]); b = px(rc[2], rc[3])
            d.rectangle([a[0], a[1], max(b[0], a[0] + 1), max(b[1], a[1] + 1)], fill=(96, 94, 96, 255))
        # highways as built decks: casing then fill; country roads thinner and brown
        for h in o['highways']:
            p = [px(q[0], q[1]) for q in h['pts']]
            if len(p) < 2: continue
            if h.get('rural'): d.line(p, fill=(150, 108, 60, 255), width=lw(h.get('w') or 11, 2))
            else:
                d.line(p, fill=(120, 70, 10, 255), width=lw((h.get('w') or 30) + 14, 4)); d.line(p, fill=(250, 196, 50, 255), width=lw(h.get('w') or 30, 2))
        # a deck over water, drawn as a bridge
        for h in o['highways']:
            for q in h.get('wet', []):
                if q[2] == 2: a = px(q[0], q[1]); d.ellipse([a[0] - 2, a[1] - 2, a[0] + 2, a[1] + 2], fill=(255, 255, 255, 255))
        # planned buildings (true footprint, rotated), homes warm, the rest dark
        for M in o.get('metros', []):
            for b in M['b']:
                c, s_ = math.cos(b[4]), math.sin(b[4]); hw2, hd = b[2] / 2, b[3] / 2
                poly = []
                for qx, qz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                    lx, lz = qx * hw2, qz * hd; poly.append(px(b[0] + lx * c + lz * s_, b[1] - lx * s_ + lz * c))
                col = (176, 96, 62, 255) if b[6] in HOME_T else ((70, 78, 110, 255) if b[5] > 40 else (104, 100, 104, 255))
                if max(b[2], b[3]) / S < 1.6: d.point(px(b[0], b[1]), fill=col)
                else: d.polygon(poly, fill=col)
        # standing structures
        for f in o['foot']:
            a = px(f[0], f[1]); b = px(f[2], f[3])
            d.rectangle([a[0], a[1], max(b[0], a[0] + 1), max(b[1], a[1] + 1)], fill=(150, 40, 40, 255))
        # 1 km grid
        Fg = font('Arial.ttf', 11)
        for x in range(int(B['minX'] // 1000) * 1000, int(B['maxX']), 1000):
            a = px(x, B['minZ']); d.line([a[0], 0, a[0], Hp], fill=(0, 0, 0, 34)); d.text((a[0] + 3, 3), str(x), font=Fg, fill=(0, 0, 0, 190))
        for z in range(int(B['minZ'] // 1000) * 1000, int(B['maxZ']), 1000):
            a = px(B['minX'], z); d.line([0, a[1], Wp, a[1]], fill=(0, 0, 0, 34)); d.text((3, a[1] + 3), str(z), font=Fg, fill=(0, 0, 0, 190))

    # ---- labels, biggest things first, none on top of another
    placed = []
    def label(x, z, text, f, fill=(20, 20, 20, 255), halo=(255, 255, 255, 230), must=False, spacing=0):
        c = px(x, z)
        tw = d.textlength(text, font=f) + spacing * max(0, len(text) - 1); th = f.size
        for dy in (0, -th * 1.1, th * 1.1, -th * 2.2, th * 2.2):
            box = (c[0] - tw / 2 - 3, c[1] + dy - th / 2 - 2, c[0] + tw / 2 + 3, c[1] + dy + th / 2 + 2)
            if must or not any(rects_hit(box, q) for q in placed):
                placed.append(box)
                if spacing:
                    xx = c[0] - tw / 2
                    for ch in text:
                        d.text((xx, c[1] + dy), ch, font=f, fill=fill, anchor='lm', stroke_width=2, stroke_fill=halo); xx += d.textlength(ch, font=f) + spacing
                else:
                    d.text((c[0], c[1] + dy), text, font=f, fill=fill, anchor='mm', stroke_width=2, stroke_fill=halo)
                return True
        return False
    if not problems_only:
        k = max(1.0, 7.0 / S) ** 0.5            # the full map letters a little larger
        F_sea = font('Arial Italic.ttf', 22 * k); F_bio = font('Arial Bold Italic.ttf', 19 * k)
        F_city = font('Arial Black.ttf', 20 * k); F_town = font('Arial Bold.ttf', 13 * k); F_small = font('Arial.ttf', 11 * k)
        plan = o.get('plan') or {}
        for L in plan.get('labels', []):
            kind = L.get('kind')
            if kind == 'sea': label(L['x'], L['z'], L['n'].upper(), F_sea, fill=(34, 70, 120, 255), halo=(170, 205, 235, 200), must=True, spacing=3)
        cities = [p for p in places.values() if p['metro'] or (p['box'][2] - p['box'][0]) * (p['box'][3] - p['box'][1]) > 1.2e6 and p['b'] not in NATURAL]
        if cityrc: label((cityrc[0] + cityrc[2]) / 2, (cityrc[1] + cityrc[3]) / 2, 'GANG CITY', F_city, must=True)
        for p in sorted(cities, key=lambda p: -p['area']):
            if p['lab']: label(p['at'][0], p['at'][1], p['n'].upper() if p['area'] > 3e6 else p['n'], F_city if p['area'] > 3e6 else F_town)
        for L in plan.get('labels', []):
            if L.get('kind') in ('range', 'land', 'water'):
                col = (60, 60, 60, 255) if L['kind'] != 'water' else (34, 70, 120, 255)
                label(L['x'], L['z'], L['n'], F_bio, fill=col, spacing=1)
        for p in sorted(places.values(), key=lambda p: -p['area']):
            if p in cities or not p['lab']: continue
            if p['b'] in NATURAL: label(p['at'][0], p['at'][1], p['n'], F_bio, fill=(50, 70, 40, 255), spacing=1)
        for L in plan.get('labels', []):
            if L.get('kind') == 'town': label(L['x'], L['z'], L['n'], F_town)
        for p in sorted(places.values(), key=lambda p: -p['area']):
            if p in cities or not p['lab'] or p['b'] in NATURAL: continue
            big = (p['box'][2] - p['box'][0]) > 150
            label(p['at'][0], p['at'][1], p['n'], F_town if big else F_small)
        # route names, once each, at the middle of the route
        F_rt = font('Arial Narrow Bold.ttf', 11 * k)
        for h in o['net']:
            if len(h['pts']) < 2 or not h.get('n'): continue
            P = h['pts']; Ls = [math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) for i in range(len(P) - 1)]
            half = sum(Ls) / 2; q = P[0]
            for i, L in enumerate(Ls):
                if half <= L: q = (P[i][0] + (P[i + 1][0] - P[i][0]) * half / max(L, 1e-6), P[i][1] + (P[i + 1][1] - P[i][1]) * half / max(L, 1e-6)); break
                half -= L
            label(q[0], q[1], h['n'], F_rt, fill=(110, 60, 0, 255), halo=(255, 240, 200, 230))

    # ---- the problems layer, on top of everything
    R = 9 if not problems_only else 7
    Fp = font('Arial Black.ttf', 11)
    LET = {'WATER': 'W', 'HWY': 'H', 'OVERLAP': 'O', 'DEADEND': 'D', 'NOROAD': 'N', 'SPAWN': 'S'}
    for p in problems:
        c = px(p['x'], p['z'])
        d.ellipse([c[0] - R, c[1] - R, c[0] + R, c[1] + R], outline=MAGENTA + (255,), width=3)
        d.text((c[0], c[1]), LET.get(p['kind'], '?'), font=Fp, fill=MAGENTA + (255,), anchor='mm', stroke_width=1, stroke_fill=(255, 255, 255, 255))
    # legend
    F_l = font('Arial Bold.ttf', 13)
    lines = ['PROBLEMS: ' + ('none' if not problems else '  '.join('%s %d' % (LET[kk] + '=' + kk, counts[kk]) for kk in LET if counts[kk]))]
    if o.get('streamed'): lines.append('STREAMED BOOT: far places are replayed records, not the built world')
    y = Hp - 8 - 18 * len(lines)
    for t in lines:
        tw = d.textlength(t, font=F_l); d.rectangle([6, y - 2, 14 + tw, y + 16], fill=(255, 255, 255, 225)); d.text((10, y), t, font=F_l, fill=MAGENTA + (255,) if problems else (20, 110, 40, 255)); y += 18
    return im

full = draw_map(S_FULL); full.save(G + 'map-full.png')
S_small = (B['maxX'] - B['minX']) / 1500.0
draw_map(S_small).save(G + 'map-small.jpg', quality=90)
draw_map(S_small, problems_only=True).save(G + 'map-problems.jpg', quality=88)
print('map-full %dx%d at %.1f m/px; problems: %s' % (full.size[0], full.size[1], S_FULL, ', '.join('%s %d' % (k, v) for k, v in sorted(counts.items())) or 'none'))
