"""tools/people/build_dutykit_pdf.py: the duty kit before/after PDF (THE DUTY KIT, ON THE REAL BODY).

    DUTY_SHOTS=DIR python3 tools/people/build_dutykit_pdf.py [OUT.pdf]

DIR holds what tools/people/wardrobe-look.mjs and a Gang City host filmed:
  before/  after/   wardrobe-look --set duty --shots full,chest,hip,profile,back
                    on the shipped code (the kit hid with the box body) and on this one
  walk/             the same officers mid-stride (--params arms=walk), this code
  hero/             wardrobe-look --shots hero (three-quarter portraits), this code
  city_before/  city_after/   live Gang City, the same crosswalk and cameras
                    (shots.json: kind, file = full length, file2 = the gun side)
Pages go through tools/storyboard-pdf.py (phone pages)."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

S = os.environ.get("DUTY_SHOTS", "/tmp/duty-shots")
C = S + "/pdfimg"
os.makedirs(C, exist_ok=True)


def rows(sub):
    """a wardrobe-look cast.json, its frames found next to it"""
    J = json.load(open(os.path.join(S, sub, "cast.json")))
    for r in J["rows"]:
        r["shots"] = {k: os.path.join(S, sub, os.path.basename(v)) for k, v in r["shots"].items()}
    return {r["id"]: r for r in J["rows"]}


def city(sub):
    p = os.path.join(S, sub, "shots.json")
    if not os.path.exists(p): return {}
    out = {}
    for s in json.load(open(p)):
        s["file"] = os.path.join(S, sub, os.path.basename(s["file"]))
        s["file2"] = os.path.join(S, sub, os.path.basename(s["file2"]))
        out[s["kind"]] = s
    return out


BEF, AFT = rows("before"), rows("after")
WALK = rows("walk") if os.path.exists(os.path.join(S, "walk", "cast.json")) else {}
HERO = rows("hero") if os.path.exists(os.path.join(S, "hero", "cast.json")) else {}
CB, CA = city("city_before"), city("city_after")


def font(sz):
    for p in ("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def tag(im, x, t, col):
    d = ImageDraw.Draw(im); f = font(20)
    d.rounded_rectangle((x, 8, x + 13 * len(t) + 18, 38), 7, fill=(15, 17, 21))
    d.text((x + 9, 11), t, font=f, fill=col)


def side(a, b, out, la="BEFORE", lb="AFTER", h=None):
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if h:
        A = A.resize((int(A.width * h / A.height), h), Image.LANCZOS); B = B.resize((int(B.width * h / B.height), h), Image.LANCZOS)
    o = Image.new("RGB", (A.width + B.width + 8, max(A.height, B.height)), (15, 17, 21))
    o.paste(A, (0, 0)); o.paste(B, (A.width + 8, 0))
    tag(o, 8, la, (232, 104, 92)); tag(o, A.width + 16, lb, (110, 210, 140))
    o.save(out)
    return out


def crop_mid(path, frac, out):
    """the middle of a wide street frame, where the officer stands"""
    im = Image.open(path).convert("RGB")
    w = int(im.width * frac)
    im.crop(((im.width - w) // 2, 0, (im.width + w) // 2, im.height)).save(out)
    return out


def grid(paths, cols, out, cell=None, labels=None):
    ims = [Image.open(p).convert("RGB") for p in paths]
    cw, ch = cell or ims[0].size
    n = (len(ims) + cols - 1) // cols
    o = Image.new("RGB", (cw * cols, ch * n), (15, 17, 21))
    d = ImageDraw.Draw(o); f = font(15)
    for i, im in enumerate(ims):
        x, y = (i % cols) * cw, (i // cols) * ch
        o.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
        if labels and labels[i]:
            d.rounded_rectangle((x + 5, y + ch - 28, x + 12 + 9 * len(labels[i]), y + ch - 5), 5, fill=(15, 17, 21))
            d.text((x + 10, y + ch - 26), labels[i], font=f, fill=(236, 238, 242))
    o.save(out)
    return out


def cid(outfit, sex="m", n=0):
    hits = [k for k in AFT if k.split("-")[3] == outfit and k.split("-")[0] == sex]
    return hits[n] if len(hits) > n else None


def nice(k):
    b = k.split("-")
    return b[3].replace("_", " ") + (" (woman)" if b[0] == "f" else "")


pages = []
P = pages.append
ids = list(AFT.keys())
# ---------------------------------------------------------------- cover
hero = grid([AFT[i]["shots"]["chest"] for i in [cid("police"), cid("sheriff"), cid("detective"), cid("police", "f"), cid("corrections"), cid("swat")] if i],
            3, C + "/hero.png", cell=(360, 432))
P({"type": "cover", "title": "COPS THAT LOOK LIKE COPS",
   "subtitle": "On a real body an officer lost his belt and his gun with the box body, and wore an open button-down over bare chest and jeans. Now: the uniform, and the whole duty kit on it.",
   "image": hero, "bullets": [
       "real uniform slacks, not jeans; the duty shirt over a crew-neck undershirt at its open collar (navy for a cop, white under a guard's black)",
       "duty belt and buckle, holster and pistol, magazine pouches, radio, torch, cuff case, a CO's keys, the badge, the radio mic",
       "the kit built by its own rules round THIS body, at true size, riding the real skeleton; it follows the game (a guard's torch leaves the belt in his hand)",
       "the detective in his suit and its real tie, the gold shield at his breast pocket, the gun under the jacket",
       "about a millisecond a person",
   ]})
# ---------------------------------------------------------------- live
if "police" in CB and "police" in CA:
    P({"type": "pair", "title": "Patrol, live in Gang City", "caption": "The same crosswalk, the same camera. Before: a man in an open button-down and jeans, no belt, no gun. After: the uniform (slacks, the undershirt at the collar), the duty belt, the holster on the gun side, the badge and the radio mic.",
       "before": CB["police"]["file"], "after": CA["police"]["file"]})
    P({"type": "pair", "title": "The gun side", "caption": "The holster and pistol hang off the belt behind the right hip, clear of it, the way the kit hangs them on any body.",
       "before": CB["police"]["file2"], "after": CA["police"]["file2"]})
for title, kinds in (("Sheriff, security, corrections", ["sheriff", "security", "corrections"]), ("SWAT, precinct, detective", ["swat", "precinct", "detective"])):
    fr = []
    for k in kinds:
        if k in CB and k in CA:
            fr.append({"path": side(crop_mid(CB[k]["file"], 0.4, f"{C}/cb_{k}.png"), crop_mid(CA[k]["file"], 0.4, f"{C}/ca_{k}.png"), f"{C}/city_{k}.png", h=560),
                       "label": k + ", live in Gang City"})
    if fr: P({"type": "stack", "title": title, "caption": "Live, before and after.", "frames": fr})
# ---------------------------------------------------------------- the uniform
if HERO:
    hk = list(HERO.keys())
    P({"type": "sheet", "title": "The uniform", "caption": "Pressed slacks, the duty shirt, the crew-neck undershirt at the open collar, the patches, nameplate and badge, the belt and its kit. A patrol officer, not a man in a button-down.",
       "image": grid([HERO[i]["shots"]["hero"] for i in hk], 3 if len(hk) > 4 else len(hk), C + "/uniform.png", cell=(420, 570), labels=[nice(i) for i in hk])})
# ---------------------------------------------------------------- the lab: up close
pm = cid("police")
if pm:
    P({"type": "pair", "title": "The hip, up close", "caption": "The same officer, rig and camera. Uniform slacks for the jeans, the belt over the shirt's tuck line, the holster where the box body's hung.",
       "before": BEF[pm]["shots"]["hip"], "after": AFT[pm]["shots"]["hip"]})
fr = []
for k in [cid("police"), cid("sheriff"), cid("police", "f")]:
    if k and "back" in AFT[k]["shots"]:
        fr.append({"path": side(BEF[k]["shots"]["back"], AFT[k]["shots"]["back"], f"{C}/back_{k.replace('~', '_').replace('^', '_')}.png"), "label": nice(k) + ", from behind"})
if fr: P({"type": "stack", "title": "Round the back", "caption": "The radio with its antenna, the torch in its ring, the cuff case, the magazine pouches, the keepers.", "frames": fr})
# ---------------------------------------------------------------- the detective
d = cid("detective")
if d:
    P({"type": "pair", "title": "The detective", "caption": "Plainclothes: his suit and its real tie, knotted at a closed collar. His duty belt and gun are under the jacket where a detective carries them; the gold shield shows at his breast pocket.",
       "before": BEF[d]["shots"]["chest"], "after": AFT[d]["shots"]["chest"]})
# ---------------------------------------------------------------- sheets
P({"type": "sheet", "title": "Every officer, before", "caption": "The shipped code: real bodies in open button-downs and jeans, no kit.",
   "image": grid([BEF[i]["shots"]["full"] for i in ids], 5, C + "/all_before.png", cell=(216, 374), labels=[nice(i) for i in ids])})
P({"type": "sheet", "title": "Every officer, after", "caption": "Police, corrections, sheriff, security, SWAT, the detectives: the uniform, and each kit rebuilt on its body.",
   "image": grid([AFT[i]["shots"]["full"] for i in ids], 5, C + "/all_after.png", cell=(216, 374), labels=[nice(i) for i in ids])})
P({"type": "sheet", "title": "On the chest", "caption": "The undershirt at the open collar in the uniform's own collar colour, the badge over the left pocket (a star for the sheriff), the radio mic above it, the nameplate and the patches.",
   "image": grid([AFT[i]["shots"]["chest"] for i in ids], 4, C + "/chests.png", cell=(270, 324), labels=[nice(i) for i in ids])})
if WALK:
    wk = list(WALK.keys())
    P({"type": "sheet", "title": "Walking", "caption": "Mid-stride the belt stays on the waist and the holster rides the hip: the kit is skinned to the real pelvis and chest.",
       "image": grid([WALK[i]["shots"][s] for i in wk for s in ("hip",) if s in WALK[i]["shots"]] + [WALK[i]["shots"]["side"] for i in wk if "side" in WALK[i]["shots"]], 5, C + "/walk.png", cell=(240, 288))})
P({"type": "text", "title": "How it works", "paragraphs": [
    "THE BUG. entities/dutykit.js hangs an officer's hard kit as one mesh built round the box body's own section. When a real (Blender) body takes over, the box body is hidden, and the kit was part of it: every cop in the city lost his belt and his gun the moment he came close enough to be real.",
    "THE SECTION. people.js measures the real body's clothed surface once per build: 48 radii round its axis every centimetre from under the hips to over the shoulders, body and garments, the arms and head left out. A centimetre the garment's vertices skipped is filled from above and below, not round the ring (that borrowed the wider sides and stood the chest out by centimetres), then dilated a bin: a stiff belt bridges the folds under it.",
    "BUILT AGAIN. dutykit.js is handed a body that answers with that section (CBZ.bodySection now asks a body for its own) and that chest. So the belt is cut round this waistband by the kit's own code, and the holster, pouches, radio and cuff case are hung off this belt and pushed clear of these hips and thighs by the same rules that hung them on the box body. Heights map hip to hip and shoulder to shoulder; the belt and everything on it keep their true size.",
    "WORN. The kit is skinned to the real skeleton (the belt and all on it to the pelvis, the badge and mic to the chest), follows the game's kit (a guard's torch out of its ring, a re-dress, a strip) and hides when the game hides it. About a millisecond a person.",
    "THE UNIFORM. Three real garments (all CC0, in the people pack): uniform wool slacks, pressed (their fold contrast cut, or dyed navy they read as denim); over them the duty shirt with its own jeans not worn (a zone of the garment dropped from its index); and a crew-neck tee worn UNDER the shirt. The tee shows only where the shirt leaves skin bare: a face is drawn only if the body vertices it is fitted to are bare, and it is fitted skin-tight so the shirt covers it everywhere else. It takes the outfit's own collar colour.",
    "THE DETECTIVE. In his suit the duty belt is under his jacket: the kit is built CONCEALED, no belt or holster shown, the gold shield on the breast.",
]})
spec = {"pages": pages}
json.dump(spec, open(S + "/dutykit_pdf.json", "w"), indent=1)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "artifacts", "people", "duty-kit-before-after.pdf")
os.makedirs(os.path.dirname(out), exist_ok=True)
r = subprocess.run(["python3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storyboard-pdf.py"), S + "/dutykit_pdf.json", out], capture_output=True, text=True)
print(r.stdout[-2000:], r.stderr[-2000:])
print(out, os.path.getsize(out) if os.path.exists(out) else "MISSING")
