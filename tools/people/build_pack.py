#!/usr/bin/env python3
"""tools/people/build_pack.py — the Blender people pack for src/entities/people.js.

    python3 tools/people/build_pack.py [--mh DIR] [--mpfb DIR] [--out assets/people]
    ZDEBUG=DIR python3 tools/people/build_pack.py   # + every garment's ZONE MAP: its texture
                                                    #   tinted by zone, islands numbered, and
                                                    #   the island table (what ZONE_RULES ids are)

Reads MakeHuman's own CC0 data straight from disk (the MPFB extension's
built-in data and the CC0 community asset packs it installs) and writes
one binary + one manifest + textures:

  base mesh     hm08, all 19158 vertices (helpers included: clothes bind to
                the tights / skirt / hair helpers), in game metres (MakeHuman
                native is Y-up decimetres facing +z, exactly the game's axes,
                so the conversion is x0.1); the BODY render mesh (13380 verts,
                split on UV seams, triangulated) with a map back to base
                indices
  shape basis   every macro target a body can use (ancestry x sex x age,
                universal sex x age x muscle x weight, breast cup x firmness)
                compressed by SVD into K principal shapes; each target ships
                its K coefficients, so the game reproduces MakeHuman's own
                macro blend (macro.json's breakpoints ship too) as
                base + sum_k coef_k * shape_k
  detail        sparse face targets (nose, jaw, chin, cheeks, eyes, mouth,
                ears, brow) for individuality
  expressions   sparse ARKit face units (faceunits01, CC0) combined into the
                game's expressions: blink, jaw, smile, pain, fear, snarl
  rig           MPFB's game_engine skeleton (53 bones): parent order, the
                joint-cube vertex lists that place every head and tail on ANY
                body, and top-4 skin weights per base vertex
  assets        eyes, brows, lashes, teeth, tongue, hair, beards, garments,
                shoes: each its own mesh (split on UVs), its MHCLO binding
                (three base vertices + weights + a scaled offset per vertex,
                the reference spans, the base vertices it hides), its
                material and textures
  skins         the ancestry x age x sex skin textures

Everything here is CC0 (MakeHuman system assets and community packs; see
assets/people/LICENSES.md, which this script writes)."""
import argparse, gzip, json, math, os, re, struct, sys, glob, hashlib
import numpy as np
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("--mpfb", default="/opt/mh/mpfb")
ap.add_argument("--data", default="/root/.config/blender/4.5/extensions/.user/user_default/mpfb/data")
ap.add_argument("--faceunits", default="/root/.config/blender/4.5/extensions/.user/user_default/mpfb/functional_faceunits01/targets/faceunits")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "..", "assets", "people"))
ap.add_argument("--k", type=int, default=40)
ap.add_argument("--tex", type=int, default=1024)
args = ap.parse_args()
MD = os.path.join(args.mpfb, "data")
UD = args.data
OUT = os.path.abspath(args.out)
os.makedirs(os.path.join(OUT, "tex"), exist_ok=True)
S = 0.1   # MakeHuman native decimetres -> metres

# ------------------------------------------------------------------ binary blob
BLOB = bytearray()
def put(arr, name=None):
    a = np.ascontiguousarray(arr)
    while len(BLOB) % 8: BLOB.append(0)
    off = len(BLOB)
    BLOB.extend(a.tobytes())
    t = {np.dtype("float32"): "f32", np.dtype("int16"): "i16", np.dtype("uint16"): "u16", np.dtype("uint32"): "u32",
         np.dtype("int32"): "i32", np.dtype("uint8"): "u8", np.dtype("int8"): "i8"}[a.dtype]
    return {"o": off, "n": int(a.size), "t": t}

# ------------------------------------------------------------------ OBJ
def parse_obj(path, want_groups=False):
    V, VT, F, G = [], [], [], []
    cur = None
    for line in open(path, encoding="utf8", errors="ignore"):
        if line.startswith("v "):
            p = line.split(); V.append((float(p[1]), float(p[2]), float(p[3])))
        elif line.startswith("vt "):
            p = line.split(); VT.append((float(p[1]), float(p[2])))
        elif line.startswith("g "):
            cur = line.split()[1] if len(line.split()) > 1 else None
        elif line.startswith("f "):
            corners = []
            for c in line.split()[1:]:
                q = c.split("/")
                corners.append((int(q[0]) - 1, int(q[1]) - 1 if len(q) > 1 and q[1] else -1))
            F.append(corners); G.append(cur)
    return np.array(V, np.float64), np.array(VT, np.float64) if VT else np.zeros((0, 2)), F, G

def split_render(F, keep=None):
    """unique (v, vt) corners -> render vertices, triangles"""
    key2r, rv, rt, tris = {}, [], [], []
    for fi, face in enumerate(F):
        if keep is not None and not keep[fi]: continue
        ids = []
        for (v, t) in face:
            k = (v, t)
            r = key2r.get(k)
            if r is None:
                r = len(rv); key2r[k] = r; rv.append(v); rt.append(t)
            ids.append(r)
        for j in range(1, len(ids) - 1):
            tris.append((ids[0], ids[j], ids[j + 1]))
    return np.array(rv, np.int64), np.array(rt, np.int64), np.array(tris, np.int64)

# ------------------------------------------------------------------ base mesh
bv, bvt, bF, bG = parse_obj(os.path.join(MD, "3dobjs", "base.obj"))
NB = len(bv)
print("base", NB, "verts", len(bF), "faces")
groups = {}
for face, g in zip(bF, bG):
    groups.setdefault(g, set()).update(v for v, _ in face)
body_keep = [g == "body" for g in bG]
rv, rt, tris = split_render(bF, body_keep)
print("body render", len(rv), "verts", len(tris), "tris")
man = {"version": 1, "units": "m", "facing": "+z", "nBase": NB}
man["base"] = {"pos": put((bv * S).astype(np.float32))}
man["body"] = {"map": put(rv.astype(np.uint16)), "uv": put(bvt[rt].astype(np.float32)), "index": put(tris.astype(np.uint16).ravel()),
               "nVerts": len(rv), "nTris": len(tris)}
# vertices that are body (not helper): a garment fitted to a helper never hides it
man["groups"] = {g: len(v) for g, v in groups.items() if not g.startswith("joint")}

# ------------------------------------------------------------------ targets
def load_target(path):
    op = gzip.open if path.endswith(".gz") else open
    idx, d = [], []
    with op(path, "rt") as f:
        for line in f:
            p = line.split()
            if len(p) != 4 or line.startswith("#"): continue
            idx.append(int(p[0])); d.append((float(p[1]), float(p[2]), float(p[3])))
    return np.array(idx, np.int64), (np.array(d, np.float64).reshape(-1, 3) * S)

macro = json.load(open(os.path.join(MD, "targets", "macrodetails", "macro.json")))
man["macro"] = {k: macro["macrotargets"][k]["parts"] for k in ["gender", "age", "muscle", "weight", "cupsize", "firmness"]}
races, sexes, ages = ["african", "asian", "caucasian"], ["female", "male"], ["baby", "child", "young", "old"]
mus = ["minmuscle", "averagemuscle", "maxmuscle"]; wts = ["minweight", "averageweight", "maxweight"]
cups = ["mincup", "averagecup", "maxcup"]; firms = ["minfirmness", "averagefirmness", "maxfirmness"]
names = []
for r in races:
    for g in sexes:
        for a in ages[1:]:
            names.append("macrodetails/%s-%s-%s" % (r, g, a))
for g in sexes:
    for a in ages[1:]:
        for m in mus:
            for w in wts:
                names.append("macrodetails/universal-%s-%s-%s-%s" % (g, a, m, w))
for a in ages[1:]:
    for m in mus:
        for w in wts:
            for c in cups:
                for f in firms:
                    if c == "averagecup" and f == "averagefirmness": continue
                    names.append("breast/female-%s-%s-%s-%s-%s" % (a, m, w, c, f))
TG = []
have = []
for n in names:
    p = os.path.join(MD, "targets", n + ".target.gz")
    if not os.path.exists(p):
        continue
    i, d = load_target(p)
    full = np.zeros((NB, 3))
    if len(i): full[i] = d
    TG.append(full.ravel()); have.append(n)
TG = np.array(TG, np.float64)
print("macro targets", len(have))
# SVD of the target stack: an orthonormal basis of every body shape the macros reach
U, Sv, Vt = np.linalg.svd(TG, full_matrices=False)
K = min(args.k, len(Sv))
B = Vt[:K]                     # K x (NB*3), orthonormal rows
C = TG @ B.T                   # coefficients of each target
# how good is it: random adult / child bodies through MakeHuman's own weighting
def comps(name, v):
    out = []
    for p in man["macro"][name]:
        if p["lowest"] < v < p["highest"]:
            t = (v - p["lowest"]) / (p["highest"] - p["lowest"])
            if p.get("low"): out.append((p["low"], 1 - t))
            if p.get("high"): out.append((p["high"], t))
    return out
def stack(gender, age, race, muscle, weight, cup=0.5, firm=0.5):
    w = {}
    cg, ca, cm, cw, cc, cf = comps("gender", gender), comps("age", age), comps("muscle", muscle), comps("weight", weight), comps("cupsize", cup), comps("firmness", firm)
    for r, rw in race.items():
        for a, aw in ca:
            for g, gw in cg:
                w["macrodetails/%s-%s-%s" % (r, g, a)] = w.get("macrodetails/%s-%s-%s" % (r, g, a), 0) + rw * gw * aw
    for g, gw in cg:
        for a, aw in ca:
            for m, mw in cm:
                for x, xw in cw:
                    k = "macrodetails/universal-%s-%s-%s-%s" % (g, a, m, x); w[k] = w.get(k, 0) + gw * aw * mw * xw
    for g, gw in cg:
        if g != "female": continue
        for a, aw in ca:
            for m, mw in cm:
                for x, xw in cw:
                    for c, cw_ in cc:
                        for f, fw in cf:
                            if c == "averagecup" and f == "averagefirmness": continue
                            k = "breast/female-%s-%s-%s-%s-%s" % (a, m, x, c, f); w[k] = w.get(k, 0) + aw * mw * xw * cw_ * fw
    return w
rng = np.random.default_rng(7)
errs = []
hidx = {n: i for i, n in enumerate(have)}
for s in range(60):
    rw = rng.dirichlet([0.5, 0.5, 0.5]); race = dict(zip(races, rw))
    w = stack(rng.choice([0.0, 1.0]) * 0.9 + rng.random() * 0.1, rng.uniform(0.22, 0.95), race, rng.uniform(0.2, 0.9), rng.uniform(0.2, 0.95), rng.uniform(0.2, 0.9), rng.uniform(0.2, 0.9))
    vec = np.zeros(NB * 3); cvec = np.zeros(K)
    for n, x in w.items():
        if n in hidx: vec += x * TG[hidx[n]]; cvec += x * C[hidx[n]]
    rec = cvec @ B
    e = np.abs(rec - vec).reshape(-1, 3)
    errs.append(np.max(np.linalg.norm(e, axis=1)))
print("SVD K=%d: worst vertex error over 60 random bodies: %.2f mm (mean worst %.2f mm)" % (K, 1000 * max(errs), 1000 * np.mean(errs)))
# int16 quantisation per component
qs = np.abs(B).max(axis=1) / 32767.0
Bq = np.round(B / qs[:, None]).astype(np.int16)
man["shape"] = {"K": K, "basis": put(Bq.ravel()), "scale": put(qs.astype(np.float32)), "targets": have,
                "coef": put(C.astype(np.float32).ravel()), "err_mm": round(1000 * max(errs), 2)}

# ------------------------------------------------------------------ sparse targets (detail, expressions)
def sparse(idx, d, name):
    m = np.abs(d).max() / 32767.0 if len(d) else 1.0
    return {"name": name, "idx": put(idx.astype(np.uint16)), "d": put(np.round(d / max(m, 1e-9)).astype(np.int16).ravel()), "s": float(m)}
DETAIL = []
for rel in ["nose/nose-scale-horiz-decr|incr", "nose/nose-scale-vert-decr|incr", "nose/nose-hump-decr|incr", "nose/nose-width1-decr|incr",
            "nose/nose-point-width-decr|incr", "nose/nose-nostrils-width-decr|incr", "chin/chin-prominent-decr|incr", "chin/chin-width-decr|incr",
            "chin/chin-height-decr|incr", "chin/chin-jutting-decr|incr", "cheek/l-cheek-bones-decr|incr", "cheek/r-cheek-bones-decr|incr",
            "mouth/mouth-scale-horiz-decr|incr", "mouth/mouth-lowerlip-volume-decr|incr", "mouth/mouth-upperlip-volume-decr|incr",
            "eyes/l-eye-scale-decr|incr", "eyes/r-eye-scale-decr|incr", "eyes/l-eye-height2-decr|incr", "eyes/r-eye-height2-decr|incr",
            "ears/l-ear-scale-decr|incr", "ears/r-ear-scale-decr|incr", "forehead/forehead-scale-vert-decr|incr",
            "head/head-oval", "head/head-round", "head/head-square", "head/head-angle-in|out", "neck/neck-scale-horiz-decr|incr",
            "eyebrows/eyebrows-trans-depth-decr|incr", "forehead/forehead-nubian-decr|incr"]:
    if "|" in rel:
        base, alt = rel.split("|")
        a = os.path.join(MD, "targets", base + ".target.gz")
        b = os.path.join(MD, "targets", base.rsplit("-", 1)[0] + "-" + alt + ".target.gz")
        if os.path.exists(a) and os.path.exists(b):
            ia, da = load_target(a); ib, db = load_target(b)
            DETAIL.append([sparse(ia, da, base.split("/")[-1]), sparse(ib, db, base.rsplit("-", 1)[0].split("/")[-1] + "-" + alt)])
    else:
        a = os.path.join(MD, "targets", rel + ".target.gz")
        if os.path.exists(a):
            ia, da = load_target(a); DETAIL.append([sparse(ia, da, rel.split("/")[-1])])
man["detail"] = DETAIL
print("detail pairs", len(DETAIL))

FU = {}
for p in glob.glob(os.path.join(args.faceunits, "*.target")):
    FU[os.path.basename(p)[:-7]] = load_target(p)
def combo(spec):
    acc = {}
    for n, w in spec:
        if n not in FU: continue
        i, d = FU[n]
        for k, v in zip(i, d): acc[k] = acc.get(k, 0) + w * v
    k = np.array(sorted(acc), np.int64)
    return k, np.array([acc[x] for x in k], np.float64) if len(k) else np.zeros((0, 3))
EXPR = {
    "blink": [("eyeBlinkLeft", 1), ("eyeBlinkRight", 1)],
    "jaw": [("jawOpen", 1)],
    "smile": [("mouthSmileLeft", 1), ("mouthSmileRight", 1), ("cheekSquintLeft", 0.5), ("cheekSquintRight", 0.5)],
    "pain": [("browDownLeft", 1), ("browDownRight", 1), ("eyeSquintLeft", 0.8), ("eyeSquintRight", 0.8), ("mouthStretchLeft", 0.7),
             ("mouthStretchRight", 0.7), ("noseSneerLeft", 0.5), ("noseSneerRight", 0.5), ("jawOpen", 0.15)],
    "fear": [("browInnerUp", 1), ("eyeWideLeft", 0.9), ("eyeWideRight", 0.9), ("mouthStretchLeft", 0.6), ("mouthStretchRight", 0.6), ("jawOpen", 0.3)],
    "snarl": [("noseSneerLeft", 1), ("noseSneerRight", 1), ("mouthUpperUpLeft", 0.8), ("mouthUpperUpRight", 0.8), ("browDownLeft", 0.6), ("browDownRight", 0.6)],
    "anger": [("browDownLeft", 1), ("browDownRight", 1), ("mouthPressLeft", 0.6), ("mouthPressRight", 0.6), ("noseSneerLeft", 0.3), ("noseSneerRight", 0.3)],
}
man["expr"] = {}
for k, spec in EXPR.items():
    i, d = combo(spec)
    man["expr"][k] = sparse(i, d, k)
print("expressions", list(man["expr"]))

# ------------------------------------------------------------------ rig
rig = json.load(open(os.path.join(MD, "rigs", "standard", "rig.game_engine.json")))
wjs = json.load(open(os.path.join(MD, "rigs", "standard", "weights.game_engine.json")))
order = []
def visit(n):
    if n in order: return
    p = rig[n].get("parent")
    if p: visit(p)
    order.append(n)
for n in rig: visit(n)
def cube(spec):
    nm = spec.get("cube_name")
    if nm and nm in groups:
        return sorted(groups[nm])
    if spec.get("vertex_indices"):
        return [int(x) for x in spec["vertex_indices"]]
    return None
bones = []
for n in order:
    b = rig[n]
    h, t = cube(b["head"]), cube(b["tail"])
    dp = lambda s: [s["default_position"][0], s["default_position"][2], -s["default_position"][1]]
    bones.append({"name": n, "parent": order.index(b["parent"]) if b.get("parent") else -1,
                  "head": h, "tail": t, "headDef": dp(b["head"]), "tailDef": dp(b["tail"])})
man["rig"] = {"bones": bones}
# skin weights: top 4 per base vertex
W = [[] for _ in range(NB)]
for bn, lst in wjs["weights"].items():
    if bn not in order: continue
    bi = order.index(bn)
    for v, w in lst:
        W[int(v)].append((w, bi))
sidx = np.zeros((NB, 4), np.uint8); swt = np.zeros((NB, 4), np.uint8)
for v in range(NB):
    l = sorted(W[v], reverse=True)[:4]
    tot = sum(w for w, _ in l) or 1.0
    for j, (w, bi) in enumerate(l):
        sidx[v, j] = bi; swt[v, j] = int(round(255 * w / tot))
    if l:
        swt[v, 0] = max(0, 255 - int(swt[v, 1:].sum()))
man["rig"]["skinIndex"] = put(sidx.ravel()); man["rig"]["skinWeight"] = put(swt.ravel())
print("rig", len(bones), "bones")

# bone groups, for classifying garment pieces and for the game's body parts
GROUP_OF = {}
for bi, n in enumerate(order):
    if n.startswith(("thigh", "calf")): GROUP_OF[bi] = "leg"
    elif n.startswith(("foot", "ball")): GROUP_OF[bi] = "foot"
    elif n.startswith(("upperarm", "lowerarm", "hand", "thumb", "index", "middle", "ring", "pinky")): GROUP_OF[bi] = "arm"
    elif n in ("head",): GROUP_OF[bi] = "head"
    else: GROUP_OF[bi] = "torso"
VGROUP = np.zeros((NB, 5))           # per base vertex: weight in torso, arm, leg, foot, head
GI = {"torso": 0, "arm": 1, "leg": 2, "foot": 3, "head": 4}
for bn, lst in wjs["weights"].items():
    if bn not in order: continue
    gi = GI[GROUP_OF[order.index(bn)]]
    for v, w in lst: VGROUP[int(v), gi] += w

# ------------------------------------------------------------------ textures
TEX = {}
def _key(path, kind, size): return (path, kind, size)
def _name(path, kind, ext):
    h = hashlib.sha1((path + kind).encode()).hexdigest()[:8]
    base = re.sub(r"[^\w]+", "_", os.path.splitext(os.path.basename(path))[0])[:32]
    return "%s_%s_%s.%s" % (base, kind, h, ext)
def _load(path, size):
    im = Image.open(path)
    if max(im.size) > size:
        r = size / max(im.size)
        im = im.resize((max(1, int(im.size[0] * r)), max(1, int(im.size[1] * r))), Image.LANCZOS)
    return im
def _blur(a, r):
    """separable box blur x3 ~ gaussian, wraps (textures are atlases, edges are seams anyway)"""
    a = a.astype(np.float64)
    for _ in range(3):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)], mode="edge"), axis=ax)
            sl_hi = [slice(None)] * a.ndim; sl_lo = [slice(None)] * a.ndim
            sl_hi[ax] = slice(2 * r + 1, None); sl_lo[ax] = slice(0, -2 * r - 1)
            a = (c[tuple(sl_hi)] - c[tuple(sl_lo)]) / (2 * r + 1)
    return a
def _normal_from_height(h, k):
    gy, gx = np.gradient(h)
    n = np.stack([-gx * k, gy * k, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(np.clip((n * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8), "RGB")
def _save(im, fn, q=84):
    full = os.path.join(OUT, "tex", fn)
    if fn.endswith(".png"): im.save(full, optimize=True)
    else: im.save(full, quality=q, optimize=True, progressive=True)
    return fn
def tex_color(path, size=1024, q=84, alpha=True):
    if not path or not os.path.exists(path): return None
    k = _key(path, "c", size)
    if k in TEX: return TEX[k]
    im = _load(path, size)
    if alpha and im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        if np.asarray(im)[..., 3].min() < 250:
            TEX[k] = _save(im, _name(path, "c", "png")); return TEX[k]
    TEX[k] = _save(im.convert("RGB"), _name(path, "c", "jpg"), q); return TEX[k]
def tex_hair(path, size=1024):
    """luminance + alpha: the shader multiplies by the person's hair colour.
       The luminance is normalised so its mean over the visible strands is 0.5
       (x2 in the shader = the hair colour on average, darker roots, lighter
       highlights) whatever colour the source was dyed."""
    if not path or not os.path.exists(path): return None, 0
    k = _key(path, "h", size)
    if k in TEX: return TEX[k]
    im = _load(path, size).convert("RGBA")
    a = np.asarray(im).astype(np.float64) / 255.0
    L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]
    vis = a[..., 3] > 0.5
    m = L[vis].mean() if vis.any() else 0.5
    Ln = np.clip(L / max(m, 1e-3) * 0.5, 0, 1)
    out = np.stack([Ln * 255, a[..., 3] * 255], axis=-1).astype(np.uint8)
    fn = _save(Image.fromarray(out, "LA"), _name(path, "h", "png"))
    TEX[k] = (fn, round(float(m), 4)); return TEX[k]
def tex_shade(diffuse, ao, size=1024, r=3):
    """the garment's cloth detail with its colour taken out: AO x the fine
       high-pass of the diffuse (weave, seams, stitching, buttons; a print or
       a plaid is lower frequency and mostly drops out), stored at 0.5 = 1.0"""
    k = _key((diffuse or "") + "|" + (ao or ""), "s", size)
    if k in TEX: return TEX[k]
    out = None
    if diffuse and os.path.exists(diffuse):
        im = _load(diffuse, size).convert("RGB")
        a = np.asarray(im).astype(np.float64) / 255.0
        L = 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2] + 0.02
        hp = np.clip(L / _blur(L, r), 0.78, 1.22)
        out = hp
    if ao and os.path.exists(ao):
        A = np.asarray(_load(ao, size).convert("L").resize(out.shape[::-1] if out is not None else _load(ao, size).size)).astype(np.float64) / 255.0
        A = 0.35 + 0.65 * A
        out = A if out is None else out * A
    if out is None: return None
    fn = _save(Image.fromarray(np.clip(out * 0.5 * 255 + 0.5, 0, 255).astype(np.uint8), "L"), _name((diffuse or "") + (ao or ""), "s", "jpg"), 86)
    TEX[k] = fn; return fn
def tex_normal(path, size=512, derive_from=None, k=3.0):
    src = path if path and os.path.exists(path) else None
    key = _key(src or derive_from or "", "n", size)
    if key in TEX: return TEX[key]
    if src:
        im = _load(src, size).convert("RGB")
    elif derive_from and os.path.exists(derive_from):
        a = np.asarray(_load(derive_from, size).convert("L")).astype(np.float64) / 255.0
        im = _normal_from_height(a - _blur(a, 6), k)
    else:
        return None
    TEX[key] = _save(im, _name(src or derive_from, "n", "jpg"), 88); return TEX[key]

def mhmat(path):
    m = {}
    if not path or not os.path.exists(path): return m
    d = os.path.dirname(path)
    for line in open(path, encoding="utf8", errors="ignore"):
        p = line.split(None, 1)
        if len(p) < 2 or line.startswith("#") or line.startswith("//"): continue
        k, v = p[0], p[1].strip()
        if k in ("diffuseTexture", "normalmapTexture", "aomapTexture", "bumpTexture", "bumpmapTexture", "transparencymapTexture"):
            f = os.path.join(d, v)
            if not os.path.exists(f): f = os.path.join(d, os.path.basename(v))
            m[k] = f if os.path.exists(f) else None
        elif k in ("transparent", "backfaceCull", "alphaToCoverage"):
            m[k] = v.lower() == "true"
        elif k in ("diffuseColor", "specularColor"):
            m[k] = [float(x) for x in v.split()[:3]]
        elif k in ("shininess", "opacity"):
            try: m[k] = float(v.split()[0])
            except Exception: pass
    return m

# ------------------------------------------------------------------ MHCLO assets
def parse_mhclo(path):
    info = {"verts": [], "delete": [], "scale": {}, "z_depth": 50, "material": None, "obj": None}
    mode = None
    d = os.path.dirname(path)
    for line in open(path, encoding="utf8", errors="ignore"):
        s = line.strip()
        if not s or s.startswith("#"): continue
        w = s.split()
        if re.match(r"^-?\d", w[0]):
            if mode == "verts":
                if len(w) == 1: info["verts"].append((int(w[0]), int(w[0]), int(w[0]), 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
                elif len(w) >= 9: info["verts"].append(tuple([int(x) for x in w[:3]] + [float(x) for x in w[3:9]]))
            elif mode == "del":
                i = 0
                while i < len(w):
                    if i + 2 < len(w) and w[i + 1] == "-":
                        info["delete"].extend(range(int(w[i]), int(w[i + 2]) + 1)); i += 3
                    else:
                        info["delete"].append(int(w[i])); i += 1
            continue
        k = w[0]
        if k == "verts": mode = "verts"
        elif k == "delete_verts": mode = "del"
        elif k in ("x_scale", "y_scale", "z_scale"): info["scale"][k[0]] = [int(w[1]), int(w[2]), float(w[3])]
        elif k == "z_depth": info["z_depth"] = int(w[1])
        elif k == "material": info["material"] = os.path.join(d, w[1])
        elif k == "obj_file": info["obj"] = os.path.join(d, w[1])
        elif k == "name": info["name"] = w[1]
    return info

def components(n, F):
    par = list(range(n))
    def f(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for face in F:
        a = f(face[0][0])
        for (v, _) in face[1:]:
            b = f(v)
            if a != b: par[b] = a
    roots = {}
    lab = np.zeros(n, np.int64)
    for v in range(n):
        r = f(v)
        lab[v] = roots.setdefault(r, len(roots))
    return lab, len(roots)

def load_asset(kind, name):
    folder = os.path.join(UD, kind, name)
    cands = glob.glob(os.path.join(folder, "*.mhclo")) + glob.glob(os.path.join(folder, "*.proxy"))
    if not cands:
        print("  MISSING", kind, name); return None
    info = parse_mhclo(cands[0])
    if not info["obj"] or not os.path.exists(info["obj"]):
        objs = glob.glob(os.path.join(folder, "*.obj"))
        info["obj"] = objs[0] if objs else None
    if not info["obj"]:
        print("  NO OBJ", kind, name); return None
    av, avt, aF, _ = parse_obj(info["obj"])
    if len(info["verts"]) != len(av):
        print("  BINDING MISMATCH", name, len(info["verts"]), len(av)); return None
    info["av"], info["avt"], info["aF"] = av, avt, aF
    info["m"] = mhmat(info["material"])
    return info

def fitted(info):
    """the asset fitted to the BASE body (MakeHuman's own formula), native dm;
       an asset's own OBJ frame is not always the body's (the bib overalls are
       modelled standing on the origin), the fitted points always are"""
    bind = np.array(info["verts"], np.float64)
    v = bv[bind[:, 0].astype(int)] * bind[:, 3:4] + bv[bind[:, 1].astype(int)] * bind[:, 4:5] + bv[bind[:, 2].astype(int)] * bind[:, 5:6]
    sc = []
    for ax, k in ((0, "x"), (1, "y"), (2, "z")):
        s_ = info["scale"].get(k)
        sc.append(abs(bv[s_[0], ax] - bv[s_[1], ax]) / s_[2] if s_ else 1.0)
    return v + bind[:, 6:9] * np.array(sc)

# ------------------------------------------------------------------ THE REAL WARDROBE: garment zones
"""A garment's own texture says what each part of it IS: a suit's panels are
one cloth, its shirt collar and cuffs another, its tie a third, its buttons
little islands of their own. Every UV island is classified once, here, into a
ZONE, so the game can dress the garment in an outfit's colours zone by zone
while the cloth keeps everything the photo-sourced texture has (the weave, the
folds, a tie's stripes or paisley, the stitching):
    0 MAIN   the garment's own cloth (a jacket, a shirt, a tee, a dress)
    1 LEGS   trousers / jeans / a skirt
    2 SHIRT  a shirt worn UNDER the main cloth (a suit's collar and cuffs, the
             tee under bib overalls or an open jacket)
    3 TIE    a tie, a bow tie
    4 TRIM   buttons, buckles, zips, a belt: kept in their own colour
    5 HIDE   part of the model the game does not wear (a cameo pendant on
             every woman in a blazer would be a uniform of its own)
Each zone ships its mean luminance (what a texel is measured against when the
cloth is recoloured) and a DETAIL strength: how much of the texture's own
light and dark survives a recolour (0 = the flat-dyed look, AO and fine weave
only; 1 = all of it)."""
Z_MAIN, Z_LEGS, Z_SHIRT, Z_TIE, Z_TRIM, Z_HIDE = 0, 1, 2, 3, 4, 5
NZ = 6
DETAIL_K = [0.85, 0.6, 0.6, 1.0, 1.0, 0.0]

def uv_islands(nvt, F):
    par = list(range(max(1, nvt)))
    def f(x):
        while par[x] != x:
            par[x] = par[par[x]]; x = par[x]
        return x
    for face in F:
        ts = [t for (_, t) in face if t >= 0]
        if not ts: continue
        a = f(ts[0])
        for t in ts[1:]:
            b = f(t)
            if a != b: par[b] = a
    roots = {}
    isl = np.zeros(max(1, nvt), np.int64)
    for t in range(nvt):
        isl[t] = roots.setdefault(f(t), len(roots))
    return isl, len(roots)

def _srgb_load(path, size=512):
    if not path or not os.path.exists(path): return None
    return np.asarray(_load(path, size).convert("RGB")).astype(np.float64) / 255.0

def _face_samples(avt, face, img, rng, n=3):
    """n random texels per triangle of a face, area-weighted by the caller"""
    H, W = img.shape[:2]
    uv = np.array([avt[t] for (_, t) in face if t >= 0])
    out, area = [], 0.0
    for j in range(1, len(uv) - 1):
        a, b, c = uv[0], uv[j], uv[j + 1]
        ar = abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
        area += ar
        k = max(1, int(round(n * min(8.0, 1 + ar * 4000))))
        for _ in range(k):
            r1, r2 = rng.random(), rng.random()
            if r1 + r2 > 1: r1, r2 = 1 - r1, 1 - r2
            q = a + r1 * (b - a) + r2 * (c - a)
            x = int(min(W - 1, max(0, (q[0] % 1.0) * W))); y = int(min(H - 1, max(0, (1 - (q[1] % 1.0)) * H)))
            out.append(img[y, x])
    return out, area

def garment_zones(info, piece_of_vert, pieces, rule):
    """per face a zone; per zone the stats the shader recolours against"""
    aF, avt = info["aF"], info["avt"]
    rule = rule or {}
    img = _srgb_load(info["m"].get("diffuseTexture"))
    isl, nI = uv_islands(len(avt), aF)
    fp = fitted(info)
    rng = np.random.default_rng(7)
    face_isl = np.array([isl[face[0][1]] if face[0][1] >= 0 else -1 for face in aF])
    I = []
    for i in range(nI):
        fs = np.where(face_isl == i)[0]
        if not len(fs): continue
        cols, area = [], 0.0
        for fi in fs:
            if img is not None:
                s, ar = _face_samples(avt, aF[fi], img, rng)
                cols += s; area += ar
        cols = np.array(cols) if cols else np.full((1, 3), 0.5)
        rgb = cols.mean(axis=0)
        L = 0.2126 * cols[:, 0] + 0.7152 * cols[:, 1] + 0.0722 * cols[:, 2]
        vs = sorted(set(v for fi in fs for (v, _) in aF[fi]))
        pos = fp[vs].mean(axis=0)
        reg = [pieces[piece_of_vert[v]]["region"] for v in vs]
        region = max(set(reg), key=reg.count)
        mx, mn = rgb.max(), rgb.min()
        I.append({"i": i, "faces": fs, "area": area * 100, "rgb": rgb, "L": float(L.mean()), "Lsd": float(L.std()),
                  "sat": float((mx - mn) / (mx + 1e-6)), "pos": pos, "region": region})
    # the garment's own cloth: the biggest colour group among its top islands
    top = [s for s in I if s["region"] in ("top", "mixed")] or I
    best, best_a = None, -1
    for s in top:
        a = sum(t["area"] for t in top if np.abs(t["rgb"] - s["rgb"]).max() < 0.09)
        if a > best_a: best, best_a = s["rgb"], a
    zone_of_isl = {}
    # a garment with a separate top piece: its hip-bound piece is the bottoms
    # (shorts, a skirt); one cut in a single piece splits at the hips
    has_top = any(p["region"] == "top" and p["n"] > 200 for p in pieces)
    for s in I:
        i, x, y, z = s["i"], s["pos"][0], s["pos"][1], s["pos"][2]
        d = float(np.abs(s["rgb"] - best).max())
        neck_front = abs(x) < 1.0 and y > 3.8 and z > 0.2
        if i in rule.get("ids", {}): zn = rule["ids"][i]
        elif s["region"] == "bottom": zn = Z_LEGS
        elif s["region"] in ("feet", "head"): zn = Z_TRIM
        # trousers / jeans / a skirt cut in one piece with the top: whatever
        # hangs below the hips (a dress's skirt is the dress's own cloth)
        elif s["region"] == "mixed" and not rule.get("dress") and (has_top or y < -0.2): zn = Z_LEGS
        elif d < rule.get("same", 0.12): zn = Z_MAIN
        elif neck_front and not rule.get("notie") and (s["sat"] > 0.3 or s["Lsd"] > 0.12) and s["L"] < 0.8 and s["area"] < 4.0: zn = Z_TIE
        elif s["L"] > 0.5 and s["sat"] < 0.25: zn = Z_SHIRT
        elif s["area"] < rule.get("trim_area", 0.4): zn = Z_TRIM
        else: zn = rule.get("other", Z_MAIN)
        if rule.get("inner") == "keep" and zn in (Z_SHIRT, Z_TIE): zn = Z_TRIM
        zone_of_isl[i] = zn
        s["zone"] = zn
    if os.environ.get("ZDEBUG") and img is not None:
        # the garment's texture with every island tinted by its zone and numbered
        tint = {Z_MAIN: (40, 120, 255), Z_LEGS: (40, 220, 90), Z_SHIRT: (255, 255, 255), Z_TIE: (255, 40, 40), Z_TRIM: (255, 200, 0), Z_HIDE: (0, 0, 0)}
        S2 = 768
        base = Image.fromarray((img * 255).astype(np.uint8)).resize((S2, S2)).convert("RGB")
        ov = Image.new("RGBA", (S2, S2), (0, 0, 0, 0))
        from PIL import ImageDraw
        dr = ImageDraw.Draw(ov)
        for s in I:
            for fi in s["faces"]:
                pts = [(avt[t][0] % 1.0 * S2, (1 - avt[t][1] % 1.0) * S2) for (_, t) in aF[fi] if t >= 0]
                if len(pts) >= 3: dr.polygon(pts, fill=tint[s["zone"]] + (110,))
        base = Image.alpha_composite(base.convert("RGBA"), ov).convert("RGB")
        dr2 = ImageDraw.Draw(base)
        for s in I:
            uv = np.array([avt[t] for fi in s["faces"][:40] for (_, t) in aF[fi] if t >= 0])
            if len(uv): dr2.text((uv[:, 0].mean() % 1.0 * S2, (1 - uv[:, 1].mean() % 1.0) * S2), str(s["i"]), fill=(255, 0, 255))
        os.makedirs(os.environ["ZDEBUG"], exist_ok=True)
        tag = rule.get("_tag") or os.path.basename(os.path.dirname(info["obj"]))
        base.save(os.path.join(os.environ["ZDEBUG"], tag + ".png"))
        with open(os.path.join(os.environ["ZDEBUG"], tag + ".txt"), "w") as fo:
            for s in sorted(I, key=lambda q: -q["area"]):
                fo.write("%3d z%d %-6s a%6.2f rgb(%.2f %.2f %.2f) L%.2f sd%.2f sat%.2f pos(%5.2f %5.2f %5.2f)\n" % (
                    s["i"], s["zone"], s["region"], s["area"], *s["rgb"], s["L"], s["Lsd"], s["sat"], *s["pos"]))
    zone_of_vt = np.array([zone_of_isl.get(int(isl[t]), Z_MAIN) for t in range(len(avt))], np.int64) if len(avt) else np.zeros(0, np.int64)
    # per zone: mean colour and mean luminance of its texels (raw sRGB, the
    # game's own convention: hexes and textures are both taken as stored)
    Zs = []
    for zn in range(NZ):
        ss = [s for s in I if s.get("zone") == zn]
        if not ss:
            Zs.append({"ref": 0.5, "mean": [0.5, 0.5, 0.5], "k": DETAIL_K[zn], "n": 0}); continue
        w = np.array([max(1e-6, s["area"]) for s in ss])
        rgb = (np.array([s["rgb"] for s in ss]) * w[:, None]).sum(0) / w.sum()
        L = float((np.array([s["L"] for s in ss]) * w).sum() / w.sum())
        k = rule.get("k", {}).get(zn, DETAIL_K[zn])
        Zs.append({"ref": round(L, 4), "mean": [round(float(c), 4) for c in rgb], "k": k, "n": len(ss)})
    info["_islands"] = I
    return zone_of_vt, Zs

# what each garment is made of, where the colour rules alone would guess wrong
ZONE_RULES = {
    # the elegant suit's shirt front and tie are ONE island (and its collar and
    # cuffs are the same white): they stay the real shirt and the real tie of
    # whichever of its fabrics is worn; the jacket and trousers take the colour
    "male_elegantsuit01": {"other": Z_TRIM, "inner": "keep", "k": {Z_MAIN: 0.9, Z_LEGS: 0.9}},
    "toigo_shift_dress": {"dress": True}, "toigo_halter_dress_knee_length": {"dress": True},
    # the casual tees carry a printed logo: dyed flat (the AO and weave stay)
    "male_casualsuit02": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}}, "male_casualsuit04": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}},
    "male_casualsuit06": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}}, "male_casualsuit03": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}},
    "female_casualsuit01": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}}, "female_casualsuit02": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}},
    "female_sportsuit01": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.3}},
    # the work shirt is denim: a uniform shirt keeps its seams, not its fade
    "male_casualsuit01": {"k": {Z_MAIN: 0.25, Z_LEGS: 0.15}},
    # the open zip jacket shows a striped tee (islands 15-18, too close to the
    # jacket's dark grey for the colour rule): the shirt under it
    "male_casualsuit05": {"ids": {15: Z_SHIRT, 16: Z_SHIRT, 17: Z_SHIRT, 18: Z_SHIRT}, "k": {Z_MAIN: 0.55, Z_SHIRT: 0.0, Z_LEGS: 0.45}},
    # bib overalls are ONE cloth front and back (no legs zone); the brass
    # buckles stay brass
    "male_worksuit01": {"notie": True, "dress": True, "ids": {4: Z_TRIM, 7: Z_TRIM}, "k": {Z_MAIN: 0.45, Z_SHIRT: 0.0}},
    # the tuxedo's pleated shirt front and collar are the shirt, the purple
    # paisley wings and knot the bow tie
    "toigo_suit_with_jacket_and_bowtie": {"ids": {4: Z_SHIRT, 6: Z_SHIRT, 33: Z_TIE, 34: Z_TIE, 35: Z_TIE}, "k": {Z_MAIN: 0.8, Z_LEGS: 0.8, Z_SHIRT: 0.7, Z_TIE: 1.0}},
    # the blazer's cameo pendant (five layered islands at the throat) goes
    "toigo_female_suit": {"ids": {0: Z_HIDE, 1: Z_HIDE, 2: Z_HIDE, 3: Z_HIDE, 4: Z_HIDE}, "k": {Z_MAIN: 0.8, Z_LEGS: 0.8}},
    "toigo_male_suit_3": {"k": {Z_MAIN: 0.8, Z_LEGS: 0.8, Z_SHIRT: 0.6, Z_TIE: 1.0}},
    "female_elegantsuit01": {"k": {Z_MAIN: 0.25, Z_LEGS: 0.7}},
    # the gilet is dyed (hi-vis, blaze orange, black): its seams, not its print
    "male_casualsuit05_gilet": {"k": {Z_MAIN: 0.35}, "_tag": "gilet"},
    "male_casualsuit06_tank": {"k": {Z_MAIN: 0.0, Z_LEGS: 0.45}, "_tag": "tank"},
    # the undershirt is one knit: its darker ribbed collar band is dyed with
    # it (not kept grey as trim) and stays darker by its own light
    "toigo_basic_tucked_t-shirt": {"same": 0.5, "trim_area": 0.0, "k": {Z_MAIN: 0.55}},
    # uniform slacks are even and pressed: dyed navy at the wool's full fold
    # contrast they read as faded denim
    "toigo_wool_pants": {"k": {Z_MAIN: 0.5, Z_LEGS: 0.22}},
}

def asset(kind, name, role, tex=None, extra=None, derive=None, zones=True):
    info = load_asset(kind, name)
    if not info: return None
    if derive: derive(info)
    av, avt, aF = info["av"], info["avt"], info["aF"]
    arv, art, atri = split_render(aF)
    bind = np.array(info["verts"], np.float64)
    e = {"kind": kind, "name": name, "role": role, "nVerts": len(av), "nRender": len(arv), "nTris": len(atri),
         "map": put(arv.astype(np.uint16)),
         "uv": put((avt[art] if len(avt) else np.zeros((len(arv), 2))).astype(np.float32)),
         "index": put(atri.astype(np.uint16 if len(arv) < 65536 else np.uint32).ravel()),
         "bv": put(bind[:, :3].astype(np.uint16).ravel()), "bw": put(bind[:, 3:6].astype(np.float32).ravel()),
         "bo": put((bind[:, 6:9] * S).astype(np.float32).ravel()), "scale": info["scale"], "z": info["z_depth"],
         "del": put(np.array(sorted(set(info["delete"])), np.uint16)) if info["delete"] else None}
    # garment pieces: connected components, each classified by the body it is
    # bound to (a casual suit is a shirt piece and a trousers piece; a suit a
    # jacket, a shirt, a tie and trousers): the runtime paints each piece from
    # the outfit atlas row that piece is (torso / jacket / arm / leg)
    if role in ("cloth", "shoes"):
        lab, nc = components(len(av), aF)
        g = (VGROUP[bind[:, 0].astype(int)] * bind[:, 3:4] + VGROUP[bind[:, 1].astype(int)] * bind[:, 4:5] + VGROUP[bind[:, 2].astype(int)] * bind[:, 5:6])
        off = np.linalg.norm(bind[:, 6:9], axis=1) * S * 1000
        pieces = []
        for c in range(nc):
            sel = lab == c
            gs = g[sel].sum(axis=0); gs = gs / max(gs.sum(), 1e-9)
            top = gs[0] + gs[1]; leg = gs[2]
            region = "feet" if gs[3] > 0.5 else ("head" if gs[4] > 0.5 else ("mixed" if top > 0.2 and leg > 0.2 else ("bottom" if leg >= top else "top")))
            y = av[sel][:, 1].mean() * S
            pieces.append({"region": region, "n": int(sel.sum()), "off": round(float(off[sel].mean()), 1), "y": round(float(y), 3),
                           "arm": round(float(gs[1]), 2)})
        e["piece"] = put(lab.astype(np.uint8))
        e["pieces"] = pieces
        if role == "cloth" and zones:
            zvt, Zs = garment_zones(info, lab, pieces, ZONE_RULES.get(zones if isinstance(zones, str) else name))
            zr = np.array([zvt[t] if t >= 0 and len(zvt) else Z_MAIN for t in art], np.uint8)
            e["zone"] = put(zr)
            e["zones"] = Zs
    if tex: e.update(tex(info))
    if extra: e.update(extra)
    if not derive: INFO[name] = info
    print("  %-8s %-34s %5d v %5d tris del %5d %s%s" % (role, name, len(av), len(atri), len(info["delete"]),
          (" pieces " + " ".join("%s:%d/%.0fmm" % (p["region"], p["n"], p["off"]) for p in e.get("pieces", []))) if e.get("pieces") else "",
          (" zones " + " ".join("%s:%d/%.2f" % ("MLSTR?"[z], Z["n"], Z["ref"]) for z, Z in enumerate(e["zones"]) if Z["n"])) if e.get("zones") else ""))
    return e

def t_hair(info):
    fn, m = tex_hair(info["m"].get("diffuseTexture"), 1024)
    return {"mat": {"map": fn, "lum": m}}
def t_small_alpha(info):
    fn, m = tex_hair(info["m"].get("diffuseTexture"), 512)
    return {"mat": {"map": fn, "lum": m}}
def t_color(size):
    def f(info):
        d = info["m"].get("diffuseTexture")
        out = {"mat": {"map": tex_color(d, size)}}
        if d and os.path.exists(d):
            a = np.asarray(Image.open(d).convert("RGB").resize((64, 64))).astype(np.float64) / 255.0
            out["mat"]["mean"] = [round(float(x), 4) for x in a.reshape(-1, 3).mean(axis=0)]
        if info["m"].get("normalmapTexture"): out["mat"]["normalMap"] = tex_normal(info["m"]["normalmapTexture"], 512)
        return out
    return f
def t_cloth(info):
    m = info["m"]
    # SHADE: a garment with its own AO + normal map takes its cloth from those
    # (the diffuse carries prints and logos a flat dye must not wear); one
    # without takes the fine high-pass of its diffuse. MAP: the garment's real
    # texture, which a zone recolours by its own light and dark (zones above)
    has_maps = bool(m.get("aomapTexture") and m.get("normalmapTexture"))
    d = m.get("diffuseTexture")
    return {"mat": {"shade": tex_shade(None if has_maps else d, m.get("aomapTexture"), 1024),
                    "map": tex_color(d, 1024, 80, alpha=False),
                    "normalMap": tex_normal(m.get("normalmapTexture"), 512, derive_from=d, k=2.0)}}

A = {}
INFO = {}
def add(key, kind, name, role, tex=None, extra=None, **kw):
    e = asset(kind, name, role, tex, extra, **kw)
    if e: A[key] = e

# DERIVED CUTS: real geometry, re-cut. The arm share of every garment vertex
# comes off its binding (the body vertices it rides and their bone groups).
def arm_share(info):
    b = np.array(info["verts"], np.float64)
    return sum(VGROUP[b[:, k].astype(int), 1] * b[:, 3 + k] for k in range(3))
def d_gilet(info):
    """male_casualsuit05's zip jacket with its sleeves cut away and its tee and
    jeans left behind: a gilet / work vest, worn OVER a shirt (a hi-vis vest,
    a blaze-orange hunting vest, a plate carrier's silhouette). It hides none
    of the body: the shirt under it does that."""
    av, aF = info["av"], info["aF"]
    lab, nc = components(len(av), aF)
    b = np.array(info["verts"], np.float64)
    off = np.linalg.norm(b[:, 6:9], axis=1) * S * 1000
    g = (VGROUP[b[:, 0].astype(int)] * b[:, 3:4] + VGROUP[b[:, 1].astype(int)] * b[:, 4:5] + VGROUP[b[:, 2].astype(int)] * b[:, 5:6])
    jacket = set(c for c in range(nc) if off[lab == c].mean() > 18 and g[lab == c][:, 2].mean() < 0.3)
    aw = arm_share(info)
    info["aF"] = [f for f in aF if lab[f[0][0]] in jacket and np.mean([aw[v] for v, _ in f]) < 0.42]
    info["delete"] = []
def d_tank(info):
    """male_casualsuit06's tee with its sleeves cut away: a tank top; the arms
    it no longer covers are the wearer's own again"""
    av, aF = info["av"], info["aF"]
    lab, nc = components(len(av), aF)
    b = np.array(info["verts"], np.float64)
    g = (VGROUP[b[:, 0].astype(int)] * b[:, 3:4] + VGROUP[b[:, 1].astype(int)] * b[:, 4:5] + VGROUP[b[:, 2].astype(int)] * b[:, 5:6])
    top = set(c for c in range(nc) if g[lab == c][:, 2].mean() < 0.3)
    aw = arm_share(info)
    info["aF"] = [f for f in aF if not (lab[f[0][0]] in top and np.mean([aw[v] for v, _ in f]) > 0.38)]
    info["delete"] = [v for v in info["delete"] if VGROUP[v, 1] < 0.22]

print("assets:")
add("eyes", "eyes", "high-poly", "eyes")
add("brows", "eyebrows", "eyebrow001", "brows", t_small_alpha)
add("lashes", "eyelashes", "eyelashes01", "lashes", t_small_alpha)
add("teeth", "teeth", "teeth_base", "teeth", t_color(512))
add("tongue", "tongue", "tongue01", "tongue", t_color(256))
# the game's hair styles (entities/character.js hairStyle) -> CC0 hair meshes
HAIR = {"short": "short02", "short_b": "cortu_short_messy_hair", "crop": "short04", "crop_b": "short01", "bob": "bob02",
        "bob_b": "toigo_blunt_bob", "long": "long01", "long_b": "culturalibre_hair_01", "pony": "ponytail01",
        "bun": "rehmanpolanski_hair_bun_brown", "pigtail": "elvs_double_mh_braid", "afro": "afro01",
        "curly": "culturalibre_hair_02", "locs": "culturalibre_hair_05", "braid": "braid01"}
for k, nm in HAIR.items(): add("hair:" + k, "hair", nm, "hair", t_hair)
BEARD = {"full": "wdg_scruffy_beard", "moustache": "rehmanpolanski_moustache_viking", "goatee": "culturalibre_faun_beard"}
for k, nm in BEARD.items(): add("beard:" + k, "clothes", nm, "beard", t_hair)
# garments: real clothes (fit, folds, collars, cuffs, hems, lapels, ties) with
# their real cloth; the game dresses them in each outfit's own colours zone by
# zone (src/entities/people.js, THE REAL WARDROBE). A uniform is BUILT from
# them (a shirt, a suit, a gilet over a shirt), never painted onto one.
CLOTH = {"m_long": "male_casualsuit02", "m_long_b": "male_casualsuit03", "m_tee": "male_casualsuit04", "m_tee_b": "male_casualsuit06",
         "m_jacket": "male_casualsuit05", "m_suit": "male_elegantsuit01", "m_overalls": "male_worksuit01",
         "m_shirt": "male_casualsuit01", "m_suit3": "toigo_male_suit_3", "m_tux": "toigo_suit_with_jacket_and_bowtie",
         "f_tee": "female_casualsuit01", "f_shorts": "female_casualsuit02", "f_sport": "female_sportsuit01",
         "f_suit": "female_elegantsuit01", "f_blazer": "toigo_female_suit",
         "f_dress": "toigo_shift_dress", "f_halter": "toigo_halter_dress_knee_length",
         # a patrol officer's: the crew-neck undershirt that shows at his open
         # collar (worn UNDER the duty shirt: people.js keeps only what the
         # collar leaves showing) and real uniform slacks, not the jeans
         "m_crew": "toigo_basic_tucked_t-shirt", "m_slacks": "toigo_wool_pants"}
for k, nm in CLOTH.items(): add("cloth:" + k, "clothes", nm, "cloth", t_cloth)
add("cloth:m_gilet", "clothes", "male_casualsuit05", "cloth", t_cloth, derive=d_gilet, zones="male_casualsuit05_gilet")
add("cloth:m_tank", "clothes", "male_casualsuit06", "cloth", t_cloth, derive=d_tank, zones="male_casualsuit06_tank")
# THE SUIT'S REAL FABRICS: male_elegantsuit01 ships in several cloths (a grey,
# a brown, navies with a striped or a paisley tie, olive, teal), each with its
# own shirt and tie. The game picks the nearest to the outfit's colour and dyes
# only the jacket and trousers the rest of the way.
SUIT_FABRICS = ["toigo_male_elegant_suit_gray", "toigo_male_elegant_suit_brown", "toigo_male_elegant_suit_blue_with_red_striped_tie",
                "toigo_male_elegant_suit_blue_pinstripe_with_paisley_tie", "toigo_male_elegant_suit_olive", "toigo_male_elegant_suit_teal"]
if "cloth:m_suit" in A:
    sinfo = INFO.get("male_elegantsuit01")
    def main_mean(path):
        img = _srgb_load(path, 512)
        rng = np.random.default_rng(3)
        cols = []
        for s in sinfo["_islands"]:
            if s.get("zone") != Z_MAIN: continue
            for fi in s["faces"][::3]:
                cs, _ = _face_samples(sinfo["avt"], sinfo["aF"][fi], img, rng, 1)
                cols += cs
        return [round(float(c), 4) for c in np.array(cols).mean(axis=0)]
    fabrics = [{"name": "black", "map": A["cloth:m_suit"]["mat"]["map"], "main": main_mean(sinfo["m"].get("diffuseTexture"))}]
    for vn in SUIT_FABRICS:
        mm = glob.glob(os.path.join(UD, "clothes", "male_elegantsuit01", vn, "*.mhmat"))
        d = mhmat(mm[0]).get("diffuseTexture") if mm else None
        if not d: print("  MISSING fabric", vn); continue
        fabrics.append({"name": vn.replace("toigo_male_elegant_suit_", ""), "map": tex_color(d, 1024, 80, alpha=False), "main": main_mean(d), "src": vn})
    A["cloth:m_suit"]["mat"]["fabrics"] = fabrics
    print("  suit fabrics", [(f["name"], f["main"]) for f in fabrics])
SHOES = {"dress": "shoes01", "boots": "shoes03", "sneakers": "shoes05", "sneakers_b": "shoes06", "flats": "toigo_ballet_flats",
         "boots_f": "toigo_ankle_boots_female"}
for k, nm in SHOES.items(): add("shoes:" + k, "clothes", nm, "shoes", t_color(512))
man["assets"] = A

# brows / lashes / eyes: one mesh each, several textures
BROWS = {}
for i in (1, 2, 3, 5, 7, 9, 10, 12):
    p = os.path.join(UD, "eyebrows", "eyebrow%03d" % i, "eyebrow%03d.png" % i)
    if os.path.exists(p): BROWS["b%d" % i] = tex_hair(p, 512)[0]
man["brows"] = BROWS
EYES = {}
for p in sorted(glob.glob(os.path.join(UD, "eyes", "materials", "*.mhmat"))):
    nm = os.path.basename(p)[:-6]
    m = mhmat(p)
    if m.get("diffuseTexture"): EYES[nm] = tex_color(m["diffuseTexture"], 512)
man["eyeMats"] = EYES

# ------------------------------------------------------------------ skins
SK = {}
WANT = re.compile(r"^(young|middleage|old)_(african|asian|caucasian)_(male|female)$")
SPECIAL = {"cutoff3d_indian_female_skin": ("young", "indian", "female"), "toigo_light_skin_male_freckles": ("young", "freckles", "male"),
           "toigo_light_skin_female_freckles": ("young", "freckles", "female"), "mindfront_skin_male_african_middleage": ("middleage", "african", "male"),
           "callharvey3d_midtoned_female": ("young", "mid", "female")}
for d in sorted(glob.glob(os.path.join(UD, "skins", "*"))):
    nm = os.path.basename(d)
    mt = WANT.match(nm)
    if not mt and nm not in SPECIAL: continue
    age, anc, sex = mt.groups() if mt else SPECIAL[nm]
    mm = glob.glob(os.path.join(d, "*.mhmat"))
    if not mm: continue
    m = mhmat(mm[0])
    if not m.get("diffuseTexture"): continue
    path = m["diffuseTexture"]
    im = Image.open(path).convert("RGB")
    a = np.asarray(im.resize((256, 256))).astype(np.float64) / 255.0
    # the tone the game's skin HEX is matched against: cheek + forearm patches
    sample = np.concatenate([a[40:70, 100:150].reshape(-1, 3), a[150:200, 20:60].reshape(-1, 3)])
    SK[nm] = {"map": tex_color(path, 1024, 85), "tone": [round(float(x), 4) for x in sample.mean(axis=0)], "age": age, "anc": anc, "sex": sex}
    print("  skin %-40s %-9s %-9s %-6s tone %s" % (nm, age, anc, sex, SK[nm]["tone"]))
man["skins"] = SK
# skin relief: pores and wrinkles as a normal map per age and sex, derived from
# the caucasian textures (every MakeHuman skin shares one UV layout)
SKN = {}
for age in ("young", "middleage", "old"):
    for sex in ("male", "female"):
        nm = "%s_caucasian_%s" % (age, sex)
        mm = glob.glob(os.path.join(UD, "skins", nm, "*.mhmat"))
        if not mm: continue
        dpath = mhmat(mm[0]).get("diffuseTexture")
        im = Image.open(dpath).convert("L").resize((1024, 1024), Image.LANCZOS)
        L = np.asarray(im).astype(np.float64) / 255.0
        h = L - _blur(L, 5)
        SKN[age + "_" + sex] = _save(_normal_from_height(h, 9.0 if age == "old" else 6.0), "skinrelief_%s_%s.jpg" % (age, sex), 88)
man["skinNormals"] = SKN
print("skin normals", list(SKN))

# ------------------------------------------------------------------ masks in body UV space
# R full beard, G goatee, B moustache, A scalp: where stubble shades the skin,
# where a shaved head shows, what the hair line under hair cards darkens
# (fitted(): the asset on the base body, defined with the garment zones)
body_idx = np.array(sorted(groups["body"]))
bpos = bv[body_idx]
def near_mask(points, radius):
    d = np.full(len(bpos), 1e9)
    for c in range(0, len(points), 512):
        q = points[c:c + 512]
        dd = ((bpos[:, None, :] - q[None, :, :]) ** 2).sum(-1).min(axis=1)
        d = np.minimum(d, dd)
    d = np.sqrt(d)
    w = np.clip(1 - (d - radius * 0.5) / (radius * 0.5), 0, 1)
    full = np.zeros(NB); full[body_idx] = w
    return full
def raster(vw, size=1024):
    img = Image.new("F", (size, size), 0.0)
    from PIL import ImageDraw
    dr = ImageDraw.Draw(img)
    for face, g in zip(bF, bG):
        if g != "body": continue
        vals = [vw[v] for v, _ in face]
        mv = sum(vals) / len(vals)
        if mv <= 0.001: continue
        pts = [(bvt[t][0] * size, (1 - bvt[t][1]) * size) for _, t in face]
        dr.polygon(pts, fill=float(mv))
    a = np.asarray(img)
    return np.clip(_blur(a, 3), 0, 1)
MASKS = []
brow_y = fitted(load_asset("eyebrows", "eyebrow001"))[:, 1].mean()
for nm, kind, rad in (("wdg_scruffy_beard", "clothes", 0.12), ("culturalibre_faun_beard", "clothes", 0.12),
                      ("rehmanpolanski_moustache_viking", "clothes", 0.10), ("short02", "hair", 0.22)):
    info = load_asset(kind, nm)
    pts = fitted(info)
    m = near_mask(pts, rad)
    if nm == "short02":
        # the scalp only: above a real hairline (~6 cm over the brows at the
        # front, falling to the ears at the side), never the forehead a
        # fringe hangs over
        y, z = bv[:, 1], bv[:, 2]
        front = np.clip((z - 0.3) / 0.9, 0, 1)              # 0 behind the crown, 1 at the forehead
        line = brow_y - 1.0 + front * 1.6                    # native dm: nape .. over the ears .. 6 cm over the brows
        m = m * np.clip((y - line) / 0.12, 0, 1)
    MASKS.append(raster(m))
# rgb = full beard / goatee / moustache; the scalp on its own (an alpha
# channel would be premultiplied away by the browser where the scalp is 0)
mask = np.stack([m * 255 for m in MASKS[:3]], axis=-1).astype(np.uint8)
man["masks"] = _save(Image.fromarray(mask, "RGB"), "facemasks.png")
man["scalpMask"] = _save(Image.fromarray((MASKS[3] * 255).astype(np.uint8), "L"), "scalpmask.png")
print("masks", man["masks"], man["scalpMask"])

# ------------------------------------------------------------------ write
open(os.path.join(OUT, "pack.bin"), "wb").write(bytes(BLOB))
json.dump(man, open(os.path.join(OUT, "pack.json"), "w"), separators=(",", ":"))
tb = sum(os.path.getsize(os.path.join(OUT, "tex", f)) for f in os.listdir(os.path.join(OUT, "tex")))
print("pack.bin %.2f MB, pack.json %.1f KB, textures %d files %.2f MB" % (len(BLOB) / 1e6, os.path.getsize(os.path.join(OUT, "pack.json")) / 1e3,
      len(os.listdir(os.path.join(OUT, "tex"))), tb / 1e6))

# ------------------------------------------------------------------ provenance
# every shipped asset, its author, licence and source page, straight from the
# MakeHuman pack manifests MPFB installed (all CC0: the exporter refuses others)
PK = {}
for f in glob.glob(os.path.join(UD, "packs", "*.json")):
    try:
        for k, v in json.load(open(f)).items(): PK.setdefault(k, dict(v, pack=os.path.basename(f)[:-5]))
    except Exception: pass
rows, bad = [], []
def prov(name, kind):
    m = PK.get(name)
    lic = (m or {}).get("license", "CC0 (MakeHuman system asset)" if name in ("high-poly", "low-poly", "teeth_base", "tongue01", "eyebrow001", "eyelashes01") else "?")
    if "CC0" not in lic.upper().replace("-", ""): bad.append(name)
    rows.append("| %s | %s | %s | %s | %s | %s |" % (name, kind, (m or {}).get("author", "MakeHuman team"), (m or {}).get("pack", "makehuman_system_assets"), lic, (m or {}).get("source", "") or "-"))
_seen = set()
for k, e in A.items():
    if e["name"] in _seen: continue          # a derived cut (the gilet, the tank) is its source garment
    _seen.add(e["name"]); prov(e["name"], e["role"])
    for fab in (e.get("mat") or {}).get("fabrics", []):
        if fab.get("src"): prov(fab["src"], "suit fabric")
for nm in SK: prov(nm, "skin")
lic_md = ["# The people pack: provenance", "",
          "Everything in `assets/people/` is derived (meshes re-indexed, textures resized / converted / recoloured, targets",
          "compressed) from MakeHuman data released **CC0 1.0** (public domain dedication): the MakeHuman base mesh hm08,",
          "its macro and detail targets, the game_engine skeleton and its weights (MakeHuman system assets, distributed with",
          "the MPFB Blender extension), the faceunits01 expression targets, and the community assets below, all from the",
          "packs the MakeHuman asset site lists as CC0. Built by `tools/people/build_pack.py`; the toolchain is",
          "`tools/blender/setup.sh`.", "",
          "| Asset | Role | Author | Pack | License | Source |", "|---|---|---|---|---|---|"] + rows
open(os.path.join(OUT, "LICENSES.md"), "w").write("\n".join(lic_md) + "\n")
print("provenance:", len(rows), "assets", ("NOT CC0: " + ", ".join(bad)) if bad else "all CC0")
if bad: sys.exit("refusing to ship non-CC0 assets: " + ", ".join(bad))
