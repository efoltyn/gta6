"""tools/people/build_pdf.py: the people before/after PDF (composites + a storyboard spec for
tools/storyboard-pdf.py). PEOPLE_SHOTS is the folder the renders went to: ppl/before (the lab kit
"humans" with skinned=0), final/* (skinned=1, walk, aim, gore), game/* (Gang City via tools/city.mjs),
cycles/* (people_render through the Blender MCP)."""
import json, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

S = os.environ.get("PEOPLE_SHOTS", "/tmp/people-shots")   # where the before/after renders were written
B = S + "/ppl/before/humans"           # the original BEFORE renders (procedural people)
F = S + "/final"
C = S + "/pdfimg"
os.makedirs(C, exist_ok=True)
CAST = ["street, 34, stubble", "street, 27, long hair", "puffer, 29, buzz + full beard", "scrubs, 41, bun",
        "office, 52, crop + moustache", "executive, 38, afro", "police, 24", "street, 71, crop + goatee",
        "street, 66, bob", "soldier, 31, buzz"]


def font(sz):
    for p in ("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    return ImageFont.load_default()


def side(a, b, out, crop=None, la="BEFORE", lb="AFTER"):
    A, Bm = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
    if crop:
        A, Bm = A.crop(crop), Bm.crop(crop)
    h = max(A.size[1], Bm.size[1])
    o = Image.new("RGB", (A.size[0] + Bm.size[0] + 8, h), (15, 17, 21))
    o.paste(A, (0, 0)); o.paste(Bm, (A.size[0] + 8, 0))
    d = ImageDraw.Draw(o); f = font(22)
    for x, t, col in ((10, la, (232, 104, 92)), (A.size[0] + 18, lb, (110, 210, 140))):
        d.rounded_rectangle((x, 10, x + 14 * len(t) + 22, 44), 8, fill=(15, 17, 21))
        d.text((x + 11, 14), t, font=f, fill=col)
    o.save(out)
    return out


def zoom(a, box, out, k=2):
    im = Image.open(a).convert("RGB").crop(box)
    im.resize((im.size[0] * k, im.size[1] * k), Image.LANCZOS).save(out)
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


pages = []
P = pages.append
# ---------------------------------------------------------------- cover
cyc = S + "/cycles"
names = ["west_african_man", "east_asian_woman", "older_white_man", "south_asian_woman", "latino_man", "black_woman"]
hero = grid([f"{cyc}/{n}-portrait.png" for n in names], 3, C + "/hero.png", cell=(360, 450))
P({"type": "cover", "title": "THE BLENDER PEOPLE", "subtitle": "Every person near the camera is now a real human body, made in Blender, skinned, and driven by the game's own animation rig.",
   "image": hero, "bullets": [
       "MakeHuman's CC0 bodies through Blender + MPFB: every ancestry, age, sex and build blended the way MakeHuman blends them",
       "real skin per ancestry and age, real eyes, brows, lashes, hair cards, beards, stubble and shaved scalps",
       "real garments fitted to each body, every uniform built from them in the outfit painters' own colours: a cop is still that cop",
       "gore on the real skin: wounds where the round lands, blood that runs and soaks cloth, real limbs that come off",
       "a Blender MCP server: build, render and export people from a prompt",
   ]})
# ---------------------------------------------------------------- line-up
P({"type": "pair", "title": "The line-up", "caption": "The same ten people, the same rigs, poses and cameras. Before: the procedural body. After: the Blender body on the same rig.",
   "before": B + "/t00001-line_up_front.png", "after": F + "/after/humans/t00001-line_up_front.png"})
P({"type": "pair", "title": "Real proportions, same height", "caption": "The procedural body is stylised (hips at 45 % of height). The real body matches its stature and keeps real legs; IK puts hands and feet where the rig's are.",
   "before": B + "/t00001-line_up_3_4.png", "after": F + "/after/humans/t00001-line_up_3_4.png"})
# ---------------------------------------------------------------- faces
fp = []
for i in range(10):
    fp.append(side(f"{B}/t00001-face_{i}.png", f"{F}/after/humans/t00001-face_{i}.png", f"{C}/face_{i}.png", crop=(200, 0, 600, 450)))
for k in range(0, 10, 3):
    fr = [{"path": fp[i], "label": f"#{i + 1}  {CAST[i]}"} for i in range(k, min(10, k + 3))]
    P({"type": "stack", "title": "Faces" if k == 0 else "Faces (cont.)",
       "caption": "Skin by ancestry and age, toned to the casting's hex; eyes with a real iris; brows, lashes; hair cards tinted to the person's hair colour; stubble and beards; the role's hat re-fitted to the real skull." if k == 0 else "",
       "frames": fr})
# ---------------------------------------------------------------- bodies + clothes
for i, cap in ((0, "Street basics: a fitted tee and jeans with real folds, seams and stitching; the colours are the outfit painter's."),
               (5, "Executive, office, police: the painted uniforms (lapels, tie, shirt V, patches, name tag) projected panel by panel onto real garments."),
               (7, "Police cap, soldier's cover: the game's own hats shrink-wrapped from the box skull onto the real one.")):
    P({"type": "pair", "title": "Clothes on real bodies", "caption": cap,
       "before": f"{B}/t00001-body_{i}_3_4.png", "after": f"{F}/after/humans/t00001-body_{i}_3_4.png"})
# ---------------------------------------------------------------- motion
P({"type": "pair", "title": "Animated by the same rig", "caption": "Walking: the gait the game already had, retargeted bone by bone onto the real skeleton.",
   "before": F + "/before_walk/humans/t00001-line_up_3_4.png", "after": F + "/after_walk/humans/t00001-line_up_3_4.png"})
P({"type": "pair", "title": "Hands where the rig's hands are", "caption": "Aiming: two-bone IK puts each wrist exactly on the rig's hand whenever it holds something, so guns stay in hands whatever the arm length.",
   "before": F + "/before_aim/humans/t00001-body_5_3_4.png", "after": F + "/after_aim/humans/t00001-body_5_3_4.png"})
# ---------------------------------------------------------------- gore
P({"type": "pair", "title": "Gore, on the real body", "caption": "The same shots and cuts. Wounds land where the round met the skin, stored in bind space so they ride every pose; blood runs down and soaks cloth; limbs come off.",
   "before": F + "/before_gore/humans/t00001-line_up_3_4.png", "after": F + "/after_gore/humans/t00001-line_up_3_4.png"})
P({"type": "stack", "title": "Wounds and dismemberment", "caption": "A severed limb collapses into its joint under a flesh-and-bone cap and the real limb (skin, sleeve, hand) is what flies.",
   "frames": [{"path": F + "/after_gore/humans/t00001-torso_1.png", "label": "arm off at the shoulder, chest wound"},
              {"path": F + "/after_gore/humans/t00001-torso_6.png", "label": "chest and arm wounds, blood soaking the uniform"},
              {"path": F + "/after_gore/humans/t00001-torso_9.png", "label": "decapitation: the neck stump"}]})
# ---------------------------------------------------------------- in game
G = S + "/game"
cw = zoom(G + "/s1_before.png", (480, 180, 1120, 400), C + "/s1b.png"); ca = zoom(G + "/s1_after.png", (480, 180, 1120, 400), C + "/s1a.png")
P({"type": "pair", "title": "In the game: the street", "caption": "Gang City, live: the nearest pedestrians and the cop wear real bodies (here everyone within 28 m, up to 18 on desktop); the same people further out stay procedural.",
   "before": cw, "after": ca})
P({"type": "pair", "title": "In the game: sitting, crossing arms", "caption": "Seated delegates sit (the pelvis comes down onto the seat as the hips flex), the standing man's crossed arms come straight off the rig.",
   "before": G + "/c1_before.png", "after": G + "/c1_after.png"})
P({"type": "pair", "title": "In the game: up close", "caption": "The same officer at arm's length.",
   "before": G + "/f1_before.png", "after": G + "/f1_after.png"})
# ---------------------------------------------------------------- Blender
P({"type": "sheet", "title": "Made in Blender", "caption": "Cycles renders through the Blender MCP server (people_render): six people built from MakeHuman's macro sliders, skins, hair and garments.",
   "image": grid([f"{cyc}/{n}-portrait.png" for n in names], 2, C + "/cyc_por.png", cell=(540, 675))})
P({"type": "sheet", "title": "Made in Blender: full body", "caption": "Rigged on the game_engine skeleton the game uses, posed, garments following the arms.",
   "image": grid([f"{cyc}/{n}-body.png" for n in names], 3, C + "/cyc_body.png", cell=(360, 540))})
# ---------------------------------------------------------------- how
P({"type": "text", "title": "How it works", "paragraphs": [
    "BLENDER. Blender 4.5 LTS with the MPFB 2 extension (MakeHuman for Blender) and the CC0 MakeHuman asset packs, headless. tools/people/build_pack.py turns that into assets/people: the hm08 body, an SVD basis of all 288 macro targets, face detail targets, ARKit face units as blend shapes, the game_engine skeleton and weights, MHCLO-bound eyes, brows, lashes, teeth, hair, beards, garments and shoes, skins, relief maps, beard and scalp masks. 11.7 MB + lazily loaded textures, all CC0 (the build refuses anything else).",
    "THE RUNTIME (src/entities/people.js). A small MakeHuman: MakeHuman's own macro weighting builds each body (sex, age, muscle, weight, ancestry mix from heritage.js), seeded face detail makes every face different, MHCLO fits the garments to that body and removes the skin under them. About 12 ms a person.",
    "ANIMATION. The procedural rig stays the source of truth (gait, aim, seats, vaults, ragdoll, gore). Each frame the skeleton is retargeted off it: rotation deltas, the person's own bone lengths, a pelvis that rides real hips, two-bone IK onto the rig's wrists and ankles. Blinks, talking and grimaces come from facial.js through blend shapes.",
    "CLOTHES. Every uniform is built from real garments (a duty shirt, a suit with its own tie, a gilet over a sleeve, bib overalls), each zone dyed in the colours the game's own outfit painter gives it; only the markings (badge, patch, tape, lettering) are lifted off the painting onto the cloth (see artifacts/people/uniforms-before-after.pdf).",
    "GORE. wounds.js and gore.js forward to the real body: wounds cast along the shot onto the skin, bind-space blood that runs and soaks, a collapsed chain with a flesh-and-bone cap, the real limb thrown by gore.js's own physics.",
    "IN THE GAME. A LOD manager gives the nearest peds real bodies (28 m in, 34 m out, 18 desktop / 8 touch, two builds a tick); pedinstance.js hands them back whole and pools them again when they leave. Flag: CBZ.CONFIG.PEOPLE_SKINNED.",
]})
P({"type": "text", "title": "The Blender MCP", "paragraphs": [
    ".mcp.json registers tools/blender/mcp_server.py as the \"blender\" MCP server; tools/blender/setup.sh installs Blender 4.5 LTS, MPFB and the CC0 packs.",
], "bullets": [
    "blender_status: what is installed (Blender, MPFB, packs, asset counts)",
    "blender_python: any Python inside headless Blender, MPFB services in scope",
    "people_assets: the hair, beards, garments, skins on disk",
    "people_render: build a person from a spec (sex, age, build, ancestry, skin, eyes, hair and colour, beard, clothes) and render it in Cycles",
    "people_export_glb: the same person rigged, as GLB",
    "people_build_pack: rebuild the game's people pack",
]})
P({"type": "text", "title": "Numbers, and what is next", "bullets": [
    "body: 14.5k vertices / 26.8k triangles; a dressed person ~45-55k triangles, ~12 meshes",
    "pack: 11.7 MB geometry + 16.5 MB textures (fetched only for what is worn); 65 assets, all CC0",
    "build: ~12 ms a person; 18 people ~0.85 M triangles",
    "next: the duty belt and holster re-fitted to the real waist like the hats (they hide with the procedural body today)",
    "next: more garment cuts (a women's long-sleeve, coats), more beard styles, eye gaze from facial.js",
]})
spec = {"pages": pages}
json.dump(spec, open(S + "/people_pdf.json", "w"), indent=1)
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "artifacts", "people", "before-after.pdf")
os.makedirs(os.path.dirname(out), exist_ok=True)
r = subprocess.run(["python3", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "storyboard-pdf.py"), S + "/people_pdf.json", out], capture_output=True, text=True)
print(r.stdout[-2000:], r.stderr[-2000:])
print(out, os.path.getsize(out) if os.path.exists(out) else "MISSING")
