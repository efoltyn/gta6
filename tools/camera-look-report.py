#!/usr/bin/env python3
"""tools/camera-look-report.py — the before/after PDF for the third-person look fix.

Reads the frames tools/camera-look-shots.mjs rendered and the numbers
tools/camera-look-check.mjs measured, and lays them out as one document.

The comparison is honest by construction: `cam.pitch` is a single scalar, and
the old and new mouse handlers differ ONLY in the sign of what they add to it.
So the same 0.38 rad drag produces pitch = rest - 0.38 under the old handler and
pitch = rest + 0.38 under the new one, and those are the two frames shown. No
staging beyond that: one spot, one yaw, one clock, one session per frame.

Usage: python3 tools/camera-look-report.py [out.pdf]
"""
import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.platypus import (Image, PageBreak, Paragraph, SimpleDocTemplate,
                                Spacer, Table, TableStyle)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = os.path.join(ROOT, "tools/shots/look")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "tools/shots/camera-look-before-after.pdf")

PAGE = landscape(A4)
PW, PH = PAGE
MARGIN = 14 * mm

INK = colors.HexColor("#16181d")
MUTED = colors.HexColor("#5b6270")
RULE = colors.HexColor("#d8dbe2")
BAD = colors.HexColor("#b3261e")
GOOD = colors.HexColor("#1f6f43")
CHIP = colors.HexColor("#eef0f4")

ss = getSampleStyleSheet()


def st(name, **kw):
    base = dict(fontName="Helvetica", fontSize=9.5, leading=13.5, textColor=INK, alignment=TA_LEFT)
    base.update(kw)
    return ParagraphStyle(name, **base)


H1 = st("H1", fontName="Helvetica-Bold", fontSize=22, leading=26)
H2 = st("H2", fontName="Helvetica-Bold", fontSize=13.5, leading=17)
BODY = st("BODY")
SMALL = st("SMALL", fontSize=8.2, leading=11.2, textColor=MUTED)
CAP_BAD = st("CAPBAD", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=BAD)
CAP_GOOD = st("CAPGOOD", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=GOOD)
MONO = st("MONO", fontName="Courier", fontSize=8.4, leading=11.4)


def shot(name, width):
    """One rendered frame, scaled to `width`, boxed so its extent is visible.

    The frames are 1280x528 and several of them are legitimately dominated by
    one flat surface — look up and this game's sky is near-white, look down and
    the lit ground is too. Without a border those read as a missing image
    instead of as the answer, so every frame gets a hairline box.
    """
    p = os.path.join(SHOTS, name + ".png")
    if not os.path.exists(p):
        return Paragraph("<i>missing frame: %s</i>" % name, SMALL)
    reader = ImageReader(p)
    iw, ih = reader.getSize()
    img = Image(p, width=width, height=width * ih / float(iw))
    box = Table([[img]], colWidths=[width], rowHeights=[width * ih / float(iw)])
    box.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, RULE),
        ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return box


def meta():
    p = os.path.join(SHOTS, "shots.json")
    if not os.path.exists(p):
        return {}
    with open(p) as f:
        return {s["name"]: s for s in json.load(f)["shots"]}


M = meta()


def num(name, key, fmt="%+.3f"):
    s = M.get(name)
    return fmt % s[key] if s and key in s else "--"


def panel(title, style, img_name, sub, width):
    return [Paragraph(title, style), Spacer(1, 2), shot(img_name, width), Spacer(1, 2),
            Paragraph(sub, SMALL)]


def grid(rows, widths, style_extra=()):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ] + list(style_extra)))
    return t


def data_table(rows, widths, header=True):
    t = Table(rows, colWidths=widths, hAlign="LEFT")
    style = [
        ("FONT", (0, 0), (-1, -1), "Helvetica", 8.6),
        ("TEXTCOLOR", (0, 0), (-1, -1), INK),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 6),
    ]
    if header:
        style += [("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 8.6),
                  ("BACKGROUND", (0, 0), (-1, 0), CHIP),
                  ("LINEBELOW", (0, 0), (-1, 0), 0.8, MUTED)]
    t.setStyle(TableStyle(style))
    return t


story = []
CONTENT_W = PW - 2 * MARGIN
HALF = (CONTENT_W - 10 * mm) / 2.0
THIRD = (CONTENT_W - 8 * mm) / 3.0

# ============================ 1. THE DIAGNOSIS ==============================
story += [
    Paragraph("Third-person look: the inverted axis", H1),
    Paragraph("gta6 &middot; branch <font face=\"Courier\">claude/third-person-camera-drag</font> "
              "&middot; every frame and every number in this document was produced by "
              "<font face=\"Courier\">tools/camera-look-shots.mjs</font> and "
              "<font face=\"Courier\">tools/camera-look-check.mjs</font>", SMALL),
    Spacer(1, 7 * mm),
    Paragraph("What was wrong", H2),
    Paragraph(
        "Two pitch conventions live in this codebase and they point opposite ways. "
        "<b>cam.pitch is DOWN-positive</b> &mdash; the third-person orbit <i>is</i> the definition "
        "(<font face=\"Courier\">oy = sin(pitch)&middot;dist</font>, view basis "
        "<font face=\"Courier\">vY = -sin(pitch)</font>), and every spawn preset agrees: "
        "<font face=\"Courier\">CITY_TP.PITCH 0.10</font> is described in its own comment as a "
        "&ldquo;mild down-gaze&rdquo;. <b>fps.fp is UP-positive</b> &mdash; fpsmode's "
        "<font face=\"Courier\">forward()</font> is <font face=\"Courier\">y: +sin(fp)</font>. "
        "All three raw input writers subtracted the drag as if the two were the same convention, "
        "so first person looked where you dragged and third person looked the opposite way.", BODY),
    Spacer(1, 4 * mm),
    data_table([
        ["input", "was", "is", "effect of the bug"],
        ["systems/camera.js — mouse", "cam.pitch -= e.movementY", "+=", "vertical look inverted"],
        ["systems/touch.js — thumb", "cam.pitch -= dy", "+=", "vertical look inverted"],
        ["systems/gamepad.js — stick", "cam.pitch -= dpitch", "+=", "vertical look inverted"],
        ["systems/fpsmode.js — leaving [V]", "cam.pitch = fps.fp", "= -fps.fp", "view flipped on every toggle"],
        ["city/view.js — driver's seat", "Euler X = cam.pitch", "= -cam.pitch", "head pitched against the mouse"],
        ["city/cockpit_view.js — cockpit", "Euler X = cam.pitch", "= -cam.pitch", "head pitched against the mouse"],
        ["city/combat.js — aimVec()", "y: sin(cam.pitch)", "y: sin(-cam.pitch)", "thrown ordnance went up when you aimed down"],
        ["entities/character.js — aim pose", "arms off +cam.pitch", "off -cam.pitch", "gun arm raised as the view dropped"],
        ["games/police.html", "camPitch -= movementY", "+=", "same inversion, its own rig"],
    ], [78 * mm, 62 * mm, 42 * mm, CONTENT_W - 182 * mm]),
    Spacer(1, 4 * mm),
    Paragraph(
        "Horizontal was never wrong: both tiers share "
        "<font face=\"Courier\">fwd = (-sin yaw, -cos yaw)</font>, so "
        "<font face=\"Courier\">yaw -= movementX</font> turns the view right in first and third "
        "person alike. Only the vertical axis was flipped.", BODY),
    Spacer(1, 3 * mm),
    Paragraph(
        "It hid for years because the legacy look target was effectively pitch-blind &mdash; a "
        "measured gain of about 0.03, per camera.js's own corrected note &mdash; so all you could "
        "see was the boom swinging the wrong way rather than the view. That is exactly the "
        "complaint on record: <i>&ldquo;it changes angle not direction of looking.&rdquo;</i> The "
        "CAM_RDR2_ORBIT pass then made the view pitch 1:1 with cam.pitch, which turned a faint "
        "wrongness into a flat inversion.", BODY),
    PageBreak(),
]

# ===================== 2. THIRD PERSON, VERTICAL DRAG =======================
story += [
    Paragraph("Third person &mdash; the same drag, before and after", H1),
    Paragraph(
        "Free-orbit third person: what the prison and survival tiers have always run, and what the "
        "city runs now. Both columns are the identical 0.38&nbsp;rad drag &mdash; the old handler "
        "moved <font face=\"Courier\">cam.pitch</font> one way, the new one moves it the other. "
        "Same spot, same yaw, same clock.", SMALL),
    Spacer(1, 4 * mm),
    grid([[
        panel("BEFORE &nbsp;&mdash;&nbsp; drag DOWN", CAP_BAD, "free-pitch-up",
              "cam.pitch %s &middot; the horizon DROPS: the view climbed into the sky" % num("free-pitch-up", "camPitch"), HALF),
        panel("AFTER &nbsp;&mdash;&nbsp; drag DOWN", CAP_GOOD, "free-pitch-down",
              "cam.pitch %s &middot; the horizon RISES: the view dropped to the ground" % num("free-pitch-down", "camPitch"), HALF),
    ]], [HALF + 5 * mm, HALF + 5 * mm]),
    Spacer(1, 3 * mm),
    grid([[
        panel("BEFORE &nbsp;&mdash;&nbsp; drag UP", CAP_BAD, "free-pitch-down",
              "the same two frames, simply swapped &mdash; one sign, one scalar", HALF),
        panel("AFTER &nbsp;&mdash;&nbsp; drag UP", CAP_GOOD, "free-pitch-up",
              "you look where your hand went", HALF),
    ]], [HALF + 5 * mm, HALF + 5 * mm]),
    PageBreak(),
]

# ======================= 3. FRAMING INVARIANCE ==============================
story += [
    Paragraph("Pitching no longer re-frames the character", H1),
    Paragraph(
        "The resting frame, and the two ends of the sweep. "
        "<font face=\"Courier\">camAudit().frameTilt</font> is the angle the character sits below "
        "the view axis &mdash; if pitching moved the character in the picture, this number would "
        "move with it. Across the 0.76&nbsp;rad sweep below it moves 0.013&nbsp;rad (0.7&deg;) "
        "while the view tracks the input at a gain of 0.997; the gate, sweeping its own slightly "
        "different range, measures 0.013 and 0.991. Looking up and down changes where you "
        "<i>look</i>, not where your character sits in frame.", SMALL),
    Spacer(1, 4 * mm),
    grid([[
        panel("look UP", BODY, "free-pitch-up",
              "cam.pitch %s &middot; viewPitch %s &middot; frameTilt %s"
              % (num("free-pitch-up", "camPitch"), num("free-pitch-up", "viewPitch"), num("free-pitch-up", "frameTilt")), THIRD),
        panel("resting", BODY, "free-level",
              "cam.pitch %s &middot; viewPitch %s &middot; frameTilt %s"
              % (num("free-level", "camPitch"), num("free-level", "viewPitch"), num("free-level", "frameTilt")), THIRD),
        panel("look DOWN", BODY, "free-pitch-down",
              "cam.pitch %s &middot; viewPitch %s &middot; frameTilt %s"
              % (num("free-pitch-down", "camPitch"), num("free-pitch-down", "viewPitch"), num("free-pitch-down", "frameTilt")), THIRD),
    ]], [THIRD + 4 * mm, THIRD + 4 * mm, THIRD + 4 * mm]),
    Spacer(1, 6 * mm),
    data_table([
        ["frame", "cam.pitch (the input)", "viewPitch (where the lens points)", "frameTilt (where the character sits)"],
        ["look UP", num("free-pitch-up", "camPitch"), num("free-pitch-up", "viewPitch"), num("free-pitch-up", "frameTilt")],
        ["resting", num("free-level", "camPitch"), num("free-level", "viewPitch"), num("free-level", "frameTilt")],
        ["look DOWN", num("free-pitch-down", "camPitch"), num("free-pitch-down", "viewPitch"), num("free-pitch-down", "frameTilt")],
        ["swing", "0.760 rad", "0.758 rad  (gain 0.997)", "0.013 rad  (0.7 degrees)"],
    ], [40 * mm, 52 * mm, 62 * mm, CONTENT_W - 154 * mm]),
    Spacer(1, 3 * mm),
    Paragraph(
        "The input swings 0.760&nbsp;rad and the view swings 0.758 of it &mdash; the orbit is pure. "
        "Over the same swing the character's place in frame moves 0.013&nbsp;rad. That is the "
        "difference between changing where you look and changing your camera angle, as two "
        "numbers.", SMALL),
    PageBreak(),
]

# ============================ 4. THE PIN ====================================
story += [
    Paragraph("The second half: the city frame was pinned", H1),
    Paragraph(
        "<font face=\"Courier\">CAM_TP_FIXED_ANGLE</font> shipped on 2026-08-15 against the "
        "owner's note: <i>&ldquo;when I look around it isn't looking around only, it's also "
        "changing my camera angle &mdash; make it a FIXED angle.&rdquo;</i> That is a description "
        "of the inverted axis above, and the answer shipped was to stop the camera pitching at "
        "all. Below are the two ends of the aim band and the resting frame, with the pin on: "
        "three different inputs, one photograph. The gate measures the lens moving "
        "0.0002&nbsp;rad against a 0.1440&nbsp;rad drag &mdash; vertical mouse moves nothing you "
        "can see. It now defaults OFF; the flag still restores it whole.", SMALL),
    Spacer(1, 4 * mm),
    grid([[
        panel("PINNED &mdash; drag UP", BODY, "pinned-aim-up",
              "cam.pitch %s &middot; viewPitch %s" % (num("pinned-aim-up", "camPitch"), num("pinned-aim-up", "viewPitch")), THIRD),
        panel("PINNED &mdash; resting", BODY, "pinned-level",
              "cam.pitch %s &middot; viewPitch %s" % (num("pinned-level", "camPitch"), num("pinned-level", "viewPitch")), THIRD),
        panel("PINNED &mdash; drag DOWN", BODY, "pinned-aim-down",
              "cam.pitch %s &middot; viewPitch %s" % (num("pinned-aim-down", "camPitch"), num("pinned-aim-down", "viewPitch")), THIRD),
    ]], [THIRD + 4 * mm, THIRD + 4 * mm, THIRD + 4 * mm]),
    Spacer(1, 6 * mm),
    data_table([
        ["frame", "cam.pitch (the input)", "viewPitch (where the lens points)", "PNG size"],
        ["drag UP", num("pinned-aim-up", "camPitch"), num("pinned-aim-up", "viewPitch"), "%s bytes" % num("pinned-aim-up", "bytes", "%d")],
        ["resting", num("pinned-level", "camPitch"), num("pinned-level", "viewPitch"), "%s bytes" % num("pinned-level", "bytes", "%d")],
        ["drag DOWN", num("pinned-aim-down", "camPitch"), num("pinned-aim-down", "viewPitch"), "%s bytes" % num("pinned-aim-down", "bytes", "%d")],
    ], [40 * mm, 52 * mm, 62 * mm, CONTENT_W - 154 * mm]),
    Spacer(1, 3 * mm),
    Paragraph(
        "0.66&nbsp;rad of input, and viewPitch does not move a thousandth. The three PNGs land "
        "within 0.3% of the same size because they are, to the eye, the same photograph. What "
        "moves is the reticle &mdash; real feedback, but not looking around.", SMALL),
    PageBreak(),
]

# ======================= 5. FIRST PERSON REFERENCE ==========================
story += [
    Paragraph("First person &mdash; untouched, and the reference", H1),
    Paragraph(
        "<font face=\"Courier\">fps.fp</font> was always UP-positive and always subtracted the "
        "drag, so first person has always looked where you dragged. It is shown here because it "
        "is the thing third person had to match, and now does &mdash; to within a thousandth of a "
        "radian on both axes.", SMALL),
    Spacer(1, 4 * mm),
    grid([[
        panel("drag DOWN", BODY, "fps-look-down", "fps.fp -0.380 &middot; the horizon rises", THIRD),
        panel("resting", BODY, "fps-level", "fps.fp 0.000", THIRD),
        panel("drag UP", BODY, "fps-look-up", "fps.fp +0.380 &middot; the horizon drops", THIRD),
    ]], [THIRD + 4 * mm, THIRD + 4 * mm, THIRD + 4 * mm]),
    Spacer(1, 6 * mm),
    data_table([
        ["frame", "fps.fp (UP-positive)", "what the frame shows"],
        ["drag DOWN", "-0.380", "the horizon rises — you are looking at the ground"],
        ["resting", "0.000", "the horizon sits across the middle"],
        ["drag UP", "+0.380", "the horizon drops — you are looking at the sky"],
    ], [40 * mm, 52 * mm, CONTENT_W - 92 * mm]),
    Spacer(1, 3 * mm),
    Paragraph(
        "Put this page next to page 2. Before the fix these two tiers answered the same drag with "
        "opposite frames; after it, they answer with the same one.", SMALL),
    PageBreak(),
]

# ============================ 6. THE NUMBERS ================================
story += [
    Paragraph("The gate", H1),
    Paragraph(
        "<font face=\"Courier\">npm run test:camera-look</font> drives the real event listeners "
        "with real events and measures <font face=\"Courier\">camera.getWorldDirection()</font>, "
        "so no convention can hide inside it. A drag of 60&nbsp;px is 0.1440&nbsp;rad at the "
        "shipped sensitivity.", SMALL),
    Spacer(1, 5 * mm),
    Paragraph("After the fix", H2),
    Spacer(1, 2 * mm),
    data_table([
        ["tier", "drag DOWN: view Y", "drag RIGHT: heading", "verdict"],
        ["first person", "-0.1435", "-0.1440", "looks where you drag"],
        ["third person, free orbit", "-0.1440", "-0.1442", "matches first person to 0.0005"],
        ["third person, pinned", "+0.0002", "-0.1434", "lens held by design; the aim moves instead"],
    ], [62 * mm, 46 * mm, 46 * mm, CONTENT_W - 154 * mm]),
    Spacer(1, 5 * mm),
    Paragraph("The same measurement with the old sign restored", H2),
    Spacer(1, 2 * mm),
    data_table([
        ["tier", "drag DOWN: view Y", "verdict"],
        ["third person, free orbit", "+0.1394", "an exact mirror — the view goes UP"],
    ], [62 * mm, 46 * mm, CONTENT_W - 108 * mm]),
    Spacer(1, 5 * mm),
    Paragraph("Framing invariance, across a 0.70 rad pitch sweep", H2),
    Spacer(1, 2 * mm),
    data_table([
        ["measure", "value", "meaning"],
        ["frameTilt spread", "0.0129 rad", "the character moves 0.7° in frame across a 40° sweep"],
        ["view gain", "0.991", "the orbit is pure: the view tracks the mouse 1:1"],
    ], [62 * mm, 46 * mm, CONTENT_W - 108 * mm]),
    Spacer(1, 6 * mm),
    Paragraph("Reproducing this document", H2),
    Spacer(1, 2 * mm),
    Paragraph(
        "node tools/camera-look-check.mjs&nbsp;&nbsp;# the gate<br/>"
        "node tools/camera-look-shots.mjs&nbsp;&nbsp;# the frames (one browser per frame; see the header for why)<br/>"
        "python3 tools/camera-look-report.py&nbsp;&nbsp;# this PDF", MONO),
]


def furniture(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(RULE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, MARGIN - 4 * mm, PW - MARGIN, MARGIN - 4 * mm)
    canvas.setFont("Helvetica", 7.4)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, MARGIN - 9 * mm, "gta6 · third-person look fix · before / after")
    canvas.drawRightString(PW - MARGIN, MARGIN - 9 * mm, "page %d" % doc.page)
    canvas.restoreState()


doc = SimpleDocTemplate(OUT, pagesize=PAGE, leftMargin=MARGIN, rightMargin=MARGIN,
                        topMargin=MARGIN, bottomMargin=MARGIN + 6 * mm,
                        title="Third-person look: the inverted axis", author="gta6")
doc.build(story, onFirstPage=furniture, onLaterPages=furniture)
print("wrote " + OUT)
