#!/usr/bin/env python3
"""tools/tp-gun-report.py — the third-person gun framing, as a PDF.

Reads the contact sheet that tools/tp-gun-view-check.mjs --matrix captured
(tools/shots/matrix-*.png + matrix.json, which carries each plate's measured
numbers) and lays it out as a report: what changed, which modes it reaches and
why the rest do not, then every weapon carried and presented, the whole
vertical aim band, both shoulders, crouch/prone, and a gun pointed at a person.

Each plate is cropped around the midpoint of the player and the muzzle using
the NDC positions the probe measured, so the weapon is actually legible at
contact-sheet size instead of being forty pixels of a 1280-wide frame.

    python3 tools/tp-gun-report.py [out.pdf]
"""
import json, os, sys
from PIL import Image
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
                                Table, TableStyle, PageBreak, KeepTogether)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools", "shots")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools", "shots", "third-person-gun-framing.pdf")
CROPDIR = os.path.join(SHOTS, "crop")
os.makedirs(CROPDIR, exist_ok=True)

with open(os.path.join(SHOTS, "matrix.json")) as f:
    PLATES = json.load(f)
BY_ID = {p["id"]: p for p in PLATES}

INK = colors.HexColor("#16181d")
MUTE = colors.HexColor("#5b6472")
RULE = colors.HexColor("#d7dbe2")
GOOD = colors.HexColor("#1c7a4a")
BAD = colors.HexColor("#a8321f")

S = getSampleStyleSheet()
def style(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK)
    base.update(kw)
    return ParagraphStyle(name, **base)

H1 = style("h1", fontName="Helvetica-Bold", fontSize=19, leading=23, spaceAfter=2)
SUB = style("sub", fontSize=10.5, leading=14, textColor=MUTE, spaceAfter=12)
H2 = style("h2", fontName="Helvetica-Bold", fontSize=12.5, leading=16, spaceBefore=13, spaceAfter=5)
H3 = style("h3", fontName="Helvetica-Bold", fontSize=10, leading=13, spaceBefore=8, spaceAfter=3)
BODY = style("body", spaceAfter=6)
SMALL = style("small", fontSize=8.2, leading=11, textColor=MUTE)
CAP = style("cap", fontSize=7.8, leading=10)
CAPM = style("capm", fontSize=7.4, leading=9.5, textColor=MUTE)
MONO = style("mono", fontName="Courier", fontSize=8, leading=11)

def crop_plate(p, wfrac=None, hfrac=None):
    """Crop around the player↔muzzle midpoint the probe measured.

    The window SCALES WITH THE BOOM, because the plates do not share a scale:
    at 4.35 m the character is a third of the frame and wants a tight crop; at
    2.20 m they already fill it and the same crop would be a portrait of an ear.
    """
    src = os.path.join(ROOT, p["file"])
    if not os.path.exists(src):
        return None
    im = Image.open(src).convert("RGB")
    W, H = im.size
    pn, mn = p.get("playerNdc"), p.get("muzNdc")
    def ok(v):
        return isinstance(v, list) and len(v) == 2 and all(isinstance(c, (int, float)) for c in v)
    if ok(pn) and ok(mn):
        cx = ((pn[0] + mn[0]) / 2.0 + 1) / 2 * W
        cy = (1 - (pn[1] + mn[1]) / 2.0) / 2 * H
    else:
        cx, cy = W * 0.42, H * 0.55
    if wfrac is None:
        d = p.get("dist") or 4.35
        wfrac = max(0.28, min(0.62, 0.28 * (4.35 / max(1.2, d))))
    if hfrac is None:
        hfrac = min(1.0, wfrac * 1.81)      # keeps the crop near 4:3
    cw, ch = W * wfrac, H * hfrac
    # keep the left HUD furniture (the character card, the minimap) out of the
    # crop where the window allows it — it is the same in every plate and it is
    # not what the reader is being shown.
    x0 = max(0, min(W - cw, cx - cw / 2))
    if cw < W - 150:
        x0 = max(150, x0)
    y0 = max(0, min(H - ch, cy - ch / 2))
    im = im.crop((int(x0), int(y0), int(x0 + cw), int(y0 + ch)))
    dst = os.path.join(CROPDIR, os.path.basename(p["file"]))
    im.save(dst, "PNG")
    return dst, cw / ch

def gate_pair():
    """The pass/fail gate's own two plates, side by side, uncropped."""
    out = []
    for f, cap in [("tp-gun-old-present.png", "BEFORE — firing, old framing"),
                   ("tp-gun-fix-present.png", "AFTER — firing, this change")]:
        src = os.path.join(SHOTS, f)
        if not os.path.exists(src):
            continue
        im = Image.open(src)
        w = W
        out.append([RLImage(src, width=w, height=w * im.size[1] / im.size[0])])
        out.append([Paragraph(cap, CAP)])
    if not out:
        return Paragraph("(gate plates missing — run npm run test:tp-gun-shots)", SMALL)
    t = Table(out, colWidths=[W])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    return t

def num(p):
    if p.get("err"):
        return "no reading"
    vis = p.get("vis")
    span = p.get("visSpan")
    if vis is None:
        return ""
    return "%d%% of the barrel reaches the lens · %.1f%% of frame height · boom %.2f m" % (
        round(vis * 100), (span or 0) * 100, p.get("dist") or 0)

def figure(pid, w, caption=None):
    p = BY_ID.get(pid)
    if not p:
        return Paragraph("(missing plate %s)" % pid, SMALL)
    got = crop_plate(p)
    if not got:
        return Paragraph("(missing image %s)" % pid, SMALL)
    dst, aspect = got
    img = RLImage(dst, width=w, height=w / aspect)
    cells = [[img], [Paragraph(caption or p["caption"], CAP)], [Paragraph(num(p), CAPM)]]
    t = Table(cells, colWidths=[w])
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
        ("BOTTOMPADDING", (0, 0), (0, 0), 3),
    ]))
    return t

def grid(ids, cols=2, width=None, gap=12):
    ids = [i for i in ids if i in BY_ID]
    if not ids:
        return Paragraph("(no plates captured for this section)", SMALL)
    width = width or (7.0 * inch)
    cw = (width - gap * (cols - 1)) / cols
    figs = [figure(i, cw) for i in ids]
    rows = []
    for i in range(0, len(figs), cols):
        row = figs[i:i + cols]
        while len(row) < cols:
            row.append("")
        rows.append(row)
    t = Table(rows, colWidths=[cw] * cols, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), gap),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t

def table(data, widths, head=True, zebra=True):
    rows = [[Paragraph(c, SMALL if not (head and r == 0) else style("th", fontName="Helvetica-Bold", fontSize=8.2, leading=11))
             for c in row] for r, row in enumerate(data)]
    t = Table(rows, colWidths=widths, hAlign="LEFT", repeatRows=1 if head else 0)
    cmds = [
        ("LINEBELOW", (0, 0), (-1, 0), 0.7, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.25, RULE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    if zebra:
        for r in range(1, len(rows)):
            if r % 2 == 0:
                cmds.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#f5f7fa")))
    t.setStyle(TableStyle(cmds))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7.5)
    canvas.setFillColor(MUTE)
    canvas.drawString(0.75 * inch, 0.5 * inch, "Third-person gun framing · gta6 · branch claude/third-person-gun-visibility-ileaxj")
    canvas.drawRightString(letter[0] - 0.75 * inch, 0.5 * inch, "page %d" % doc.page)
    canvas.restoreState()

doc = SimpleDocTemplate(OUT, pagesize=letter,
                        leftMargin=0.75 * inch, rightMargin=0.75 * inch,
                        topMargin=0.7 * inch, bottomMargin=0.75 * inch,
                        title="Third-person gun framing", author="Claude Code")
W = letter[0] - 1.5 * inch
st = []

# ============================ 1. WHAT CHANGED ============================
st += [
    Paragraph("Seeing your own gun", H1),
    Paragraph('“In our third person when holding gun you can’t see the gun. Use this ref to fix '
              'angle so we can see the gun better when shooting.”', SUB),
    Paragraph(
        'Measured before anything was touched: while firing, <b>0% of the drawn weapon’s barrel reached the '
        'lens</b>. Not “a bit small” — none of it. The gun spent every gunfight behind the shoulder of the '
        'person holding it. Three passes later — a framing table, a plain aim bug, and a new carry pose — '
        '<b>firing shows 77% of the barrel and carrying shows 100%</b>, measured, not eyeballed.', BODY),
    Spacer(1, 4),
    gate_pair(),
    Paragraph(
        '<b>The cause was not the shoulder offset.</b> That is what the eye reaches for first, and it is the '
        'weaker lever: at a 4.35 m boom, 0.68 m of offset is 9° of frame, and doubling it buys about 6 cm of '
        'clearance past a torso your own firing arm is standing in front of. The lever that decides it is the '
        '<b>look lead</b>. Leading the look target 12 m down-range grows the camera rig’s derived frame tilt to '
        '~0.17 rad, which settles the character low in frame and silhouettes the weapon against the thing it is '
        'pointed at. Scoping (RMB) always had that lead — which is exactly why aiming down sights was the one '
        'armed state you could see your own gun in — and <i>firing did not</i>. To the camera, shooting was '
        'indistinguishable from walking.', BODY),
    Paragraph(
        '<b>A plain bug underneath it.</b> While the third-person frame was pinned, the drawn weapon’s barrel '
        'was aimed along the <i>lens</i> rather than along your actual aim — the gun pointed wherever the camera '
        'rested while the bullets, the reticle and the acquire cone went somewhere else. The path that draws the '
        'gun you actually see now takes the same aim vector the bullets take. (The pin itself has since been '
        'retired on main — vertical look moves the camera again — which makes this fix a no-op by identity '
        'today; it stays because the pin is still one console flag away, and turning it back on must not send '
        'the barrel back to the horizon.)', BODY),
    Paragraph(
        '<b>And the carry needed the hand, not the lens.</b> The first pass proved a thigh-hung rifle cannot be '
        'framed into view: it lies exactly along the leg’s silhouette, so the same constants measured 54% or 0% '
        'depending on where the idle breath had the arm, and every centimetre of camera offset made it worse. So '
        'the carry changed the <b>pose</b>: long guns are now carried at <b>port arms</b> — hand at the lower '
        'chest, barrel diagonally up across the body — which is broadside to the camera at every framing, '
        'measures 92% visible at 15% of frame height, and is robust where the hang was a knife edge (every '
        'direction in the sweep grid clears 92%). The support hand follows automatically: it is IK-solved onto '
        'the handguard wherever the handguard is, and the reload animation still runs through the same anchors '
        '(the off-hand gate passes on every weapon).', BODY),
    Paragraph(
        'So armed framing now reads a three-tier table — <b>carry</b> (gun out), <b>present</b> (trigger down, '
        'firing, or the 0.9 s settle after a shot), <b>ADS</b> (scoped) — and the present tier takes the frame '
        'that already worked. The signal itself is not new: the code has published “presenting” for its camera '
        'damping all along; framing was the last consumer still ignoring it.', BODY),
    Spacer(1, 2),
    table([
        ["state", "barrel reaching the lens", "size on screen", ""],
        ["firing, before", "0%", "—", "the gun is behind its owner"],
        ["<b>firing, after</b>", "<b>77%</b>", "<b>10% of frame height</b>", "framing table + the aim-bug fix"],
        ["carrying, before", "54% on a knife edge", "0–5%", "a thigh-hung rifle inside the leg’s silhouette"],
        ["<b>carrying, after</b>", "<b>100%</b>", "<b>16% of frame height</b>", "port arms — a pose fix, not a camera fix"],
        ["scoping (for scale)", "77%", "8%", "unchanged; it always worked"],
    ], [1.35 * inch, 1.5 * inch, 1.45 * inch, W - 4.3 * inch]),
    Paragraph('Measured on the airport apron, carbine, same spot, same moment of the trigger pull, by '
              '<font face="Courier">npm run test:tp-gun</font>.', SMALL),
    PageBreak(),
]

# ======================= 2. WHICH MODES THIS REACHES =======================
st += [
    Paragraph("Which modes this actually changes", H1),
    Paragraph("and why it is not all of them", SUB),
    Paragraph(
        'A mode has to clear <b>three independent gates</b> to feel the whole change. Almost every “why not that '
        'one?” below is one of these three failing, and they fail for different reasons.', BODY),
    table([
        ["gate", "the test in code", "what fails it"],
        ["1. the page",
         '<font face="Courier">index.html</font> is the only page that loads '
         '<font face="Courier">systems/camera.js</font>, <font face="Courier">city/camera.js</font> and '
         '<font face="Courier">systems/holsterprops.js</font>',
         "every standalone page under games/ — including the NPC war simulator"],
        ["2. the rig",
         '<font face="Courier">mode === "city" &amp;&amp; !driving</font> selects the CITY_TP tier table; '
         "everything else runs the older boom with its own constants",
         "prison and gun game — same engine, different camera constants"],
        ["3. the signal",
         '<font face="Courier">tpPresenting()</font> = armed, on foot, third person, and '
         "aiming / trigger down / within 0.9 s of a shot",
         "natural disaster — it has no trigger at all"],
    ], [0.85 * inch, 3.3 * inch, W - 4.15 * inch]),
    Paragraph("The verdict, mode by mode", H2),
    Paragraph('Four separate changes went in. A mode gets the ones its own code path can reach:', SMALL),
    Spacer(1, 4),
    table([
        ["mode", "barrel follows<br/>your aim", "tier table +<br/>12 m lead", "tighter boom<br/>while firing", "carry<br/>pose", "net effect"],
        ["<b>City</b> (on foot)", "yes", "yes", "n/a", "yes", "the whole change — every plate in this PDF"],
        ["<b>Gang war</b>", "yes", "yes", "n/a", "yes", "not a mode: gangs, turf, civil war and police war are city systems, so a gang fight <i>is</i> city mode"],
        ["<b>Prison</b> (escape)", "no*", "no", "yes", "yes", "boom comes in 7.6 → 5.0 m while you present, and long guns port-carry there too"],
        ["<b>Natural disaster</b>", "no*", "no", "no", "no", "no combat in that mode — nothing can raise the presenting signal"],
        ["<b>Gun game</b>", "no*", "no", "yes", "no", "camera as prison; its gun is drawn by the older prop path"],
        ["<b>NPC war</b> (battle page)", "no", "no", "no", "no", "separate page, no player gun, no chase camera at all"],
        ["<b>First person</b>", "no", "no", "no", "no", "the armed tier requires third person, by construction"],
        ["<b>Driving / flying / boats</b>", "no", "no", "no", "no", "the vehicle chase owns the camera; the held gun is hidden"],
    ], [1.15 * inch, 0.72 * inch, 0.68 * inch, 0.72 * inch, 0.62 * inch, W - 3.89 * inch]),
    Paragraph('* not “skipped” — <i>already correct</i>. The barrel was only ever wrong where the camera is '
              'pinned away from the aim, and that pin is city-on-foot only. Everywhere else the aim vector and '
              'the lens are the same vector, so the fix is a no-op by identity rather than by exclusion.', SMALL),
    Paragraph("Why each “no” is a no", H2),
    Paragraph(
        '<b>Natural disaster is the interesting one.</b> Its own header says it: “No combat: just survive longer '
        'than everyone else.” The mouse handler returns early in that mode — the grapple system owns the buttons '
        '— so nothing ever sets aim-held or trigger-held, and <font face="Courier">tpPresenting()</font> can '
        'never become true. Because the change is gated on presenting rather than on merely being armed, it is a '
        'guaranteed no-op there rather than a silent framing change nobody asked for. (One honest edge: a gamepad’s '
        'aim button calls the same hook without a mode guard, so a pad holding aim while carrying an owned gun '
        'would reach the tier. Mouse and touch cannot.)', BODY),
    Paragraph(
        '<b>The NPC war page is not affected in any sense.</b> <font face="Courier">games/battle.html</font> loads '
        'the NPC weapon system and the weapon models, and none of the three files this change touches. It has no '
        'player-held gun and no over-the-shoulder rig — you watch armies from a spectator camera. Nothing to reframe.',
        BODY),
    Paragraph(
        '<b>And NPCs never changed anywhere.</b> Other people’s guns are posed by a different system entirely '
        '(<font face="Courier">systems/actorweapons.js</font>), which this work does not touch. A cop levelling a '
        'rifle at you looks exactly as it did before — only <i>your</i> weapon’s framing moved. That is why the '
        'in-city wars (a hundred militia shooting at each other) look the same in the middle distance and only '
        'change in your own hands.', BODY),
    Paragraph(
        '<b>Prison gets the half that was missing, not the whole table.</b> It runs a different camera rig — its own '
        'boom, its own collision floor, no fixed-angle pin — so the city’s tier table simply is not read there. But it '
        'already led its look target 12 m while armed, which the city measurements say is the half that matters; what '
        'it lacked was standing close enough to use it. Pulling the boom to 5.0 m while presenting is the port of the '
        'city finding, reasoned across from those numbers rather than measured on its own stage: the gate only boots '
        'the city.', BODY),
    PageBreak(),
]

# ===================== 3. EVERY WEAPON, CARRIED AND PRESENTED =====================
GUNS = [p["id"].split("-")[1] for p in PLATES if p["id"].startswith("gun-") and p["id"].endswith("-carry")]
st += [
    Paragraph("Every gun in the game, carried and presented", H1),
    Paragraph("left column: gun out, walking (now port arms for long guns) · right column: trigger down", SUB),
    Paragraph(
        'Long guns are carried at port arms — up across the body, both hands on — and read clearly in both '
        'columns; presenting swings the same weapon down onto the crosshair. <b>Pistols still read worst</b>: a '
        'sidearm is a third the length of a carbine and hangs beside the thigh, so its carry column is honest '
        'about a few dark pixels at the hip. That remains a pose question (a chest-high pistol carry reads as '
        'aiming), and it is left open rather than papered over.', BODY),
    Spacer(1, 2),
]
for i, g in enumerate(GUNS):
    if i and i % 4 == 0:
        st.append(PageBreak())
        st.append(Paragraph("Every gun, carried and presented <i>(continued)</i>", H2))
    st.append(grid(["gun-%s-carry" % g, "gun-%s-present" % g], cols=2, width=W))
st.append(PageBreak())

# ============================ 4. ANGLES ============================
ANG = [p["id"] for p in PLATES if p.get("group") == "angles"]
st += [
    Paragraph("Angles", H1),
    Paragraph("the whole vertical aim band, both shoulders, and the low stances — all presenting, carbine", SUB),
    Paragraph(
        'Vertical aim pitches the camera 1:1 with the mouse (the fixed-angle pin that used to hold the frame '
        'was retired on main once the inverted-look bug behind it was fixed), and the barrel tracks the same '
        'aim vector the bullets use — so the weapon stays on the crosshair through the whole band instead of '
        'freezing at the horizon. The character holds their place in frame across the sweep; only the view '
        'direction changes.', BODY),
    Spacer(1, 2),
    grid(ANG, cols=2, width=W),
    PageBreak(),
]

# ======================= 5. POINTED AT SOMEONE =======================
TGT = [p["id"] for p in PLATES if p.get("group") == "target"]
if TGT:
    st += [
        Paragraph("Pointed at someone", H1),
        Paragraph("the shot that has to work: the frame must hold the weapon and the person it is aimed at", SUB),
        Paragraph(
            'A frame that shows your gun by pushing the target out of shot has not solved anything. Standing about '
            '7.5 m off a pedestrian, the weapon sits left of centre and the person it is levelled at sits on the '
            'crosshair, in all three tiers.', BODY),
        Spacer(1, 2),
        grid(TGT, cols=2, width=W),
        PageBreak(),
    ]

# ======================= 6. THE NUMBERS + HOW TO CHECK =======================
rows = [["plate", "barrel reaching the lens", "size on screen", "boom", "muzzle in frame"]]
for p in PLATES:
    if p.get("err"):
        rows.append([p["caption"], "—", "—", "—", "no reading"])
        continue
    rows.append([
        p["caption"],
        "%d%%" % round((p.get("vis") or 0) * 100),
        "%.1f%% of frame height" % ((p.get("visSpan") or 0) * 100),
        "%.2f m" % (p.get("dist") or 0),
        "yes" if p.get("muzVisible") else "<font color='#a8321f'>no</font>",
    ])
st += [
    Paragraph("The numbers behind every plate", H1),
    Paragraph("measured from the live camera at the moment each screenshot was taken", SUB),
    Paragraph(
        '“Can you see it” is not a matter of taste here. The gate walks the drawn weapon’s own bore in screen '
        'space, thirteen points from receiver to muzzle, and ray-tests each one against the player’s own body: '
        'what survives is what you can see. It runs with the fix on and off from the same spot in the same boot, '
        'so the comparison is like for like.', BODY),
    table(rows, [2.5 * inch, 1.1 * inch, 1.35 * inch, 0.6 * inch, W - 5.55 * inch]),
    Paragraph("Run it yourself", H2),
    Paragraph('<font face="Courier">npm run test:tp-gun</font> — the pass/fail gate (boots the city, arms you '
              'through the real pickup path, prints the table above)<br/>'
              '<font face="Courier">npm run test:tp-gun-shots</font> — same, plus before/after plates<br/>'
              '<font face="Courier">node tools/tp-gun-view-check.mjs --matrix</font> — regenerates this contact sheet<br/>'
              '<font face="Courier">node tools/tp-gun-view-check.mjs --sweep</font> — walks the constant grid and '
              'prints what each combination measures', BODY),
    Paragraph("Turning it off", H2),
    Paragraph('<font face="Courier">CBZ.CONFIG.CAM_TP_GUN_VISIBLE = false</font> in the console restores the old '
              'framing on the next frame, in every mode listed on the mode page, with no reload.', BODY),
    Paragraph("What is deliberately still open", H2),
    Paragraph(
        '<b>Pistols.</b> Better than before while presenting, and honestly small while carried — a thigh-hung '
        'sidearm is a few dark pixels at the hip. The long-gun answer (port arms) does not transfer: a pistol '
        'held at chest height reads as aiming, not carrying. If it ever matters, the lever is again the hand, '
        'not the lens.', BODY),
    Paragraph(
        '<b>The left shoulder.</b> The swap (MMB) keeps the weapon on your right side, so the left-shoulder '
        'frame shows less of it by construction. Mirroring the pose with the swap would fix it and is a bigger '
        'bite than this pass.', BODY),
    Paragraph(
        '<b>Prison and gun game are reasoned, not measured.</b> The gate only boots the city. Their change is the '
        'boom trim while presenting, ported from the city numbers.', BODY),
]

doc.build(st, onFirstPage=footer, onLaterPages=footer)
print("wrote", OUT, "(%d plates)" % len(PLATES))
