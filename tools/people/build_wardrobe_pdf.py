"""tools/people/build_wardrobe_pdf.py: the uniforms before/after PDF (THE REAL WARDROBE).

    WARDROBE_SHOTS=DIR python3 tools/people/build_wardrobe_pdf.py [OUT.pdf]

DIR holds what tools/people/wardrobe-look.mjs and a Gang City host filmed:
  before/       wardrobe-look --set uniforms on the shipped code (uniforms painted onto real garments)
  after/        the same cast on this code (uniforms built from real garments)
  city_before/  city_after/   the same uniformed pedestrians, same cameras, live Gang City
  zones.png  marks.png        how it is built (optional)
Pages go through tools/storyboard-pdf.py (phone pages)."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

S = os.environ.get("WARDROBE_SHOTS", "/tmp/wardrobe-shots")
C = S + "/pdfimg"
os.makedirs(C, exist_ok=True)
BEF, AFT = json.load(open(S + "/before/cast.json")), json.load(open(S + "/after/cast.json"))
ROWS = {r["id"]: (r, AFT["rows"][i]) for i, r in enumerate(BEF["rows"])}


def font(sz):
    for p in ("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def side(a, b, out, la="BEFORE", lb="AFTER"):
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    h = max(A.size[1], B.size[1])
    o = Image.new("RGB", (A.size[0] + B.size[0] + 8, h), (15, 17, 21))
    o.paste(A, (0, 0)); o.paste(B, (A.size[0] + 8, 0))
    d = ImageDraw.Draw(o); f = font(20)
    for x, t, col in ((8, la, (232, 104, 92)), (A.size[0] + 16, lb, (110, 210, 140))):
        d.rounded_rectangle((x, 8, x + 13 * len(t) + 18, 38), 7, fill=(15, 17, 21))
        d.text((x + 9, 11), t, font=f, fill=col)
    o.save(out)
    return out


def grid(paths, cols, out, cell=None, bg=(15, 17, 21)):
    ims = [Image.open(p).convert("RGB") for p in paths]
    cw, ch = cell or ims[0].size
    rows = (len(ims) + cols - 1) // cols
    o = Image.new("RGB", (cw * cols, ch * rows), bg)
    for i, im in enumerate(ims):
        o.paste(im.resize((cw, ch), Image.LANCZOS), ((i % cols) * cw, (i // cols) * ch))
    o.save(out)
    return out


def pair_of(cid, shot):
    b, a = ROWS[cid]
    return b["shots"].get(shot), a["shots"].get(shot)


def by_outfit(oid, n=0):
    hits = [k for k in ROWS if k.split("-")[3] == oid]
    return hits[n] if len(hits) > n else None


pages = []
P = pages.append
# ---------------------------------------------------------------- cover
hero_ids = [by_outfit(o) for o in ("driver", "police", "construction", "doctor", "soldier", "tuxedo")]
hero = grid([ROWS[i][1]["shots"]["chest"] for i in hero_ids if i], 3, C + "/hero.png", cell=(360, 432))
P({"type": "cover", "title": "THE REAL WARDROBE", "subtitle": "Every uniform in the game rebuilt from real clothes: real collars, lapels, ties, vests, overalls and fabric, in each outfit's own colours. No more uniforms painted onto a T-shirt.",
   "image": hero, "bullets": [
       "a uniform is BUILT now: a duty shirt, a three-piece suit with its own tie, a hi-vis gilet over a long sleeve, bib overalls over a tee, a bow-tie tuxedo",
       "the colours are still the game's own outfit designs (read off each painter), so a cop is the same navy up close and at 100 m",
       "only the MARKINGS come off the painting: the badge, the nameplate, the agency patch, reflective tape, a red cross, lettering",
       "real woodland camouflage printed on the body, not pixel blocks",
       "64 outfits checked one by one, plus live Gang City",
   ]})
# ---------------------------------------------------------------- the chauffeur
d = by_outfit("driver")
b, a = pair_of(d, "chest")
P({"type": "pair", "title": "The chauffeur", "caption": "Before: a waistcoat drawn as a polygon, a tie as a stripe and buttons as dots, painted round a long-sleeve tee. After: a real three-piece suit with its own collar, lapels, pocket square and knotted tie, dyed the chauffeur's navy.",
   "before": b, "after": a})
b, a = pair_of(d, "full")
P({"type": "pair", "title": "The chauffeur, head to toe", "caption": "The same person, rig, pose and camera.", "before": b, "after": a})
# ---------------------------------------------------------------- the trades, three to a page
GROUPS = [
    ("Police", "A real duty shirt (collar, placket, yoke, pockets); the nameplate and the agency patch lifted off the painter onto it.", ["police", "police@1", "corrections"]),
    ("Law and security", "", ["sheriff", "security", "swat"]),
    ("Emergency", "Reflective tape where the painter put it, on real cloth: the EMS shirt and the turnout coat.", ["ems", "firefighter", "doctor"]),
    ("Military", "Real woodland camouflage in the uniform's own olive, printed on the body so it runs across every seam.", ["soldier", "soldier@1", "hunter"]),
    ("Hi-vis", "A real gilet (a work jacket with its sleeves cut away) over a long sleeve, the tape on the vest.", ["construction", "hivis", "groundcrew"]),
    ("Kitchen and service", "", ["chef", "waiter", "valet"]),
    ("Travel", "", ["pilot", "cabincrew", "busdriver"]),
    ("The office", "A plain shirt and a painted tie become a suit with a real tie.", ["office", "office@1", "detective"]),
    ("Tailoring", "The executive wears the suit's own cloth (a navy pinstripe with a paisley tie); the tuxedo its real bow tie and pleated shirt.", ["exec_navy", "exec_navy@1", "tuxedo"]),
    ("On the land and the water", "Real bib overalls, a real campaign-hat ranger.", ["farmer", "fisherman", "ranger"]),
    ("Inside", "", ["inmate", "inmate_tank", "janitor"]),
    ("Street and sport", "", ["varsity", "leather", "lifeguard"]),
]
for title, cap, ids in GROUPS:
    fr = []
    for spec in ids:
        oid, _, n = spec.partition("@")
        cid = by_outfit(oid, int(n or 0))
        if not cid: continue
        b, a = pair_of(cid, "chest")
        if not (b and a): continue
        p = side(b, a, f"{C}/{cid.replace('~', '_').replace('^', '_')}.png")
        bits = cid.split("-")
        fr.append({"path": p, "label": f"{bits[3].replace('_', ' ')}  ({'woman' if bits[0] == 'f' else 'man'}, {bits[4].split('~')[0]})"})
    if fr: P({"type": "stack", "title": title, "caption": cap, "frames": fr})
# ---------------------------------------------------------------- full sheets
for half, rng in (("1", range(0, 32)), ("2", range(32, 64))):
    ids = [r["id"] for i, r in enumerate(AFT["rows"]) if i in rng and r["shots"].get("full")]
    if ids:
        P({"type": "sheet", "title": "Every outfit, after (" + half + "/2)", "caption": "Each one a real garment, or a stack of them, in the outfit painter's colours.",
           "image": grid([ROWS[i][1]["shots"]["full"] for i in ids], 8, f"{C}/all{half}.png", cell=(200, 347))})
# ---------------------------------------------------------------- in the game
cb, ca = S + "/city_before", S + "/city_after"
if os.path.exists(ca + "/shots.json"):
    for sh in json.load(open(ca + "/shots.json")):
        k = sh["kind"]
        bp, ap = f"{cb}/{k}.png", f"{ca}/{k}.png"
        if os.path.exists(bp) and os.path.exists(ap):
            P({"type": "pair", "title": "In the game: " + k.replace("_", " "), "caption": "Gang City, live, the same pedestrian and the same camera: the painted uniform on the real body, then the real wardrobe.",
               "before": bp, "after": ap})
# ---------------------------------------------------------------- how
if os.path.exists(S + "/zones.png"):
    P({"type": "sheet", "title": "How: every garment knows its parts", "caption": "Each UV island of each garment is classified once, from its own texture: blue = the main cloth, green = trousers / skirt, white = the shirt under it, red = the tie, yellow = buttons and buckles (kept), black = left off (a cameo pendant). The game dyes zone by zone and keeps the cloth's own light and dark.",
       "image": S + "/zones.png"})
if os.path.exists(S + "/marks.png"):
    P({"type": "sheet", "title": "How: only the markings come off the painting", "caption": "Left of each pair the painter's picture, right what is lifted from it: a pixel that is not the cloth and not a shade of it, in a run that is small (a badge, a patch, a letter) or a band (tape). Painted vests, pockets, plackets and ties stay behind: the real garment has its own.",
       "image": S + "/marks.png"})
P({"type": "text", "title": "How it works", "paragraphs": [
    "GARMENTS. tools/people/build_pack.py ships the real garments with their own textures: the casual suits, the elegant suit in seven real cloths (each with its own shirt and tie), a three-piece navy suit with a tie, a bow-tie tuxedo, a women's blazer suit, a denim work shirt, bib overalls, and two cuts made from them (a gilet and a tank top, sleeves cut away by the bones they ride). Every UV island is sorted into a zone (main cloth, trousers, shirt, tie, trim) with its mean luminance.",
    "THE WARDROBE. src/entities/people.js maps every outfit the game has to garment layers. Each zone is dyed by its texels' own light and dark against the zone's mean, so the weave, folds, stitching and a tie's pattern come through in any colour. The colours are read off the outfit's own painter (city/clothes.js), which stays the one place an outfit is designed.",
    "MARKINGS. The painter's picture is read at 1x for runs that are not the cloth and not a shade of it; small runs and bands stay, the rest (painted structure) goes; the kept cells are lifted at 4x, crisp, and laid on the garment through the body projection. In the city this happens on a quiet tick after the person appears.",
    "CAMOUFLAGE. Woodland in the uniform's own colour (its base, a darker shade, an earth brown, a light khaki), printed from three noise fields in bind space: it rides the body and runs across every seam.",
    "PRINTS. A patterned dress, gingham, a kid's printed tee: there the painter's picture IS the fabric, and it is still printed onto the real garment.",
]})
spec = {"pages": pages}
json.dump(spec, open(S + "/wardrobe_pdf.json", "w"), indent=1)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "artifacts", "people", "uniforms-before-after.pdf")
os.makedirs(os.path.dirname(out), exist_ok=True)
r = subprocess.run(["python3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storyboard-pdf.py"), S + "/wardrobe_pdf.json", out], capture_output=True, text=True)
print(r.stdout[-2000:], r.stderr[-2000:])
print(out, os.path.getsize(out) if os.path.exists(out) else "MISSING")
