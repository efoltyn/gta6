#!/usr/bin/env python3
"""tools/blender/mcp_server.py — BLENDER, AS A TOOL CLAUDE CAN HOLD.

A stdio MCP server (registered in .mcp.json as "blender") that drives a
headless Blender 4.5 LTS with the MPFB 2 extension (MakeHuman for Blender)
and the CC0 MakeHuman asset packs. It is how the game's people are made:

  blender_status       what is installed: Blender, MPFB, packs, asset counts
  blender_python       run Python inside Blender (bpy + MPFB services ready:
                       HS TS RS MS LS, asset(kind, name), skin(name), reset())
  people_assets        list the hair / beards / clothes / skins / eyes ... on disk
  people_render        build one person (sex, age, build, ancestry mix, skin,
                       eyes, hair, beard, garments, shoes) and render it in
                       Cycles: a portrait or full body PNG
  people_export_glb    the same person, rigged (game_engine skeleton), as GLB
  people_build_pack    rebuild assets/people (tools/people/build_pack.py): the
                       pack src/entities/people.js builds every ped from

Install the toolchain first: tools/blender/setup.sh (Blender, MPFB, packs).
Every tool runs Blender as a subprocess (`blender -b --python`), so a crash
in a script never takes the server down.
"""
import json, os, subprocess, sys, tempfile, textwrap, glob, time

try:
    from mcp.server.mcpserver import MCPServer as FastMCP   # mcp >= 2 (FastMCP was renamed)
except ImportError:
    from mcp.server.fastmcp import FastMCP                  # mcp 1.x

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLENDER = os.environ.get("BLENDER", "/opt/blender/blender")
USER_DATA = os.environ.get("MPFB_DATA", os.path.expanduser("~/.config/blender/4.5/extensions/.user/user_default/mpfb/data"))
OUT_DIR = os.environ.get("PEOPLE_OUT", os.path.join(tempfile.gettempdir(), "blender-people"))
os.makedirs(OUT_DIR, exist_ok=True)

# the helpers every Blender-side script starts with
PRELUDE = textwrap.dedent('''
    import bpy, addon_utils, importlib, os, glob, math, json, sys
    PKG = [m.__name__ for m in addon_utils.modules() if m.__name__.endswith("mpfb")][0]
    def svc(name, cls): return getattr(importlib.import_module(PKG + ".services." + name), cls)
    def enable(): addon_utils.enable(PKG, default_set=True)
    enable()
    HS = svc("humanservice", "HumanService"); TS = svc("targetservice", "TargetService")
    LS = svc("locationservice", "LocationService"); RS = svc("rigservice", "RigService")
    MS = svc("materialservice", "MaterialService"); OS_ = svc("objectservice", "ObjectService")
    DATA = LS.get_user_data()
    def asset(kind, name, ext=".mhclo"):
        p = os.path.join(DATA, kind, name, name + ext)
        if os.path.exists(p): return p
        c = glob.glob(os.path.join(DATA, kind, name, "*" + ext))
        if c: return c[0]
        raise FileNotFoundError(kind + "/" + name + ext)
    def skin(name): return asset("skins", name, ".mhmat")
    def reset():
        bpy.ops.wm.read_factory_settings(use_empty=True); enable()
''')

mcp = FastMCP("blender")


def _run(code: str, timeout: int = 600) -> dict:
    """run a script in headless Blender; returns exit code + the log tail"""
    if not os.path.exists(BLENDER):
        return {"ok": False, "log": f"Blender not found at {BLENDER}: run tools/blender/setup.sh"}
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(PRELUDE + "\n" + code)
        path = f.name
    t0 = time.time()
    try:
        r = subprocess.run([BLENDER, "-b", "--factory-startup", "--python-exit-code", "3", "--python", path],
                           capture_output=True, text=True, timeout=timeout)
        log = (r.stdout + "\n" + r.stderr).strip().splitlines()
        # Blender's own banner and colour-management chatter are noise
        log = [l for l in log if not l.startswith(("Blender ", "Read prefs", "Color management", "Fra:")) and "OpenColorIO" not in l]
        return {"ok": r.returncode == 0, "seconds": round(time.time() - t0, 1), "log": "\n".join(log[-120:])}
    except subprocess.TimeoutExpired:
        return {"ok": False, "log": f"timed out after {timeout} s"}
    finally:
        os.unlink(path)


@mcp.tool()
def blender_status() -> dict:
    """What is installed: Blender version, MPFB, the MakeHuman asset packs and how many assets of each kind."""
    out = {"blender": BLENDER, "exists": os.path.exists(BLENDER), "data": USER_DATA, "assets": {}}
    if os.path.exists(BLENDER):
        r = subprocess.run([BLENDER, "-b", "--factory-startup", "--version"], capture_output=True, text=True, timeout=60)
        out["version"] = r.stdout.strip().splitlines()[0] if r.stdout else r.stderr[-200:]
    for kind in ("skins", "hair", "eyebrows", "eyelashes", "eyes", "clothes", "proxymeshes", "teeth", "tongue"):
        d = os.path.join(USER_DATA, kind)
        out["assets"][kind] = len([x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x))]) if os.path.isdir(d) else 0
    pk = os.path.join(USER_DATA, "packs")
    out["packs"] = sorted(os.listdir(pk)) if os.path.isdir(pk) else []
    return out


@mcp.tool()
def blender_python(code: str, timeout: int = 600) -> dict:
    """Run Python inside headless Blender 4.5 with MPFB enabled. In scope: bpy, HS (HumanService),
    TS (TargetService), RS (RigService), MS (MaterialService), LS (LocationService),
    asset(kind, name) -> .mhclo path, skin(name) -> .mhmat path, reset() (empty scene).
    print() what you want back; the log tail is returned."""
    return _run(code, timeout)


@mcp.tool()
def people_assets(kind: str = "hair", contains: str = "") -> list:
    """List installed MakeHuman assets of one kind (skins, hair, eyebrows, eyelashes, eyes, clothes,
    proxymeshes, teeth, tongue). Beards, hats and shoes live under 'clothes'."""
    d = os.path.join(USER_DATA, kind)
    if not os.path.isdir(d):
        return []
    return sorted(x for x in os.listdir(d) if os.path.isdir(os.path.join(d, x)) and contains.lower() in x.lower())


PERSON = textwrap.dedent('''
    spec = json.loads(SPEC)
    reset()
    macro = TS.get_default_macro_info_dict()
    for k in ("gender", "age", "muscle", "weight", "height", "proportions", "cupsize", "firmness"):
        if k in spec: macro[k] = float(spec[k])
    if "race" in spec: macro["race"] = {k: float(spec["race"].get(k, 0)) for k in ("african", "asian", "caucasian")}
    bm = HS.create_human(macro_detail_dict=macro)
    for t, v in (spec.get("targets") or {}).items():
        try: TS.set_target_value(bm, t, float(v))
        except Exception as e: print("target", t, e)
    HS.set_character_skin(skin(spec.get("skin", "young_caucasian_male")), bm, skin_type="ENHANCED_SSS")
    # the skeleton BEFORE the assets: MPFB rigs (weights by binding) only what
    # is added to a body that already has one
    rig = HS.add_builtin_rig(bm, spec.get("rig", "game_engine")) if spec.get("rig", "game_engine") else None
    def put(kind, name, atype):
        try: HS.add_mhclo_asset(asset(kind, name), bm, asset_type=atype, subdiv_levels=0)
        except Exception as e: print("asset", kind, name, e)
    put("eyes", spec.get("eyes", "high-poly"), "Eyes")
    put("eyebrows", spec.get("eyebrows", "eyebrow001"), "Eyebrows")
    put("eyelashes", spec.get("eyelashes", "eyelashes01"), "Eyelashes")
    if spec.get("hair"): put("hair", spec["hair"], "Hair")
    for c in spec.get("clothes", []): put("clothes", c, "Clothes")
    if spec.get("beard"): put("clothes", spec["beard"], "Clothes")
    # HAIR AND BEARDS ARE CARDS: their texture's alpha must cut them (MakeHuman's
    # beard materials ship without it, which renders solid spikes), and they
    # take the person's hair colour (the textures are dyed whatever they were
    # painted in)
    def tint_cards(obj, rgb):
        # MPFB wraps its shading in node groups, so this works on any tree: the
        # texture's colour goes through luminance x the hair colour wherever it
        # was linked, and the surface is mixed with a transparent BSDF by the
        # texture's alpha right at the material output
        for slot in obj.material_slots:
            m = slot.material
            if not m or not m.use_nodes: continue
            nt = m.node_tree
            img = next((n for n in nt.nodes if n.type == "TEX_IMAGE" and n.image), None)
            out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
            if not img or not out: continue
            if rgb:
                links = [l for l in nt.links if l.from_node == img and l.from_socket.name == "Color"]
                bw = nt.nodes.new("ShaderNodeRGBToBW"); nt.links.new(img.outputs["Color"], bw.inputs[0])
                gain = nt.nodes.new("ShaderNodeMath"); gain.operation = "MULTIPLY"; gain.inputs[1].default_value = 1.8
                nt.links.new(bw.outputs[0], gain.inputs[0])
                mix = nt.nodes.new("ShaderNodeMixRGB"); mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1.0
                nt.links.new(gain.outputs[0], mix.inputs[1]); mix.inputs[2].default_value = (rgb[0], rgb[1], rgb[2], 1.0)
                for l in links:
                    to = l.to_socket; nt.links.remove(l); nt.links.new(mix.outputs[0], to)
            surf = next((l for l in nt.links if l.to_node == out and l.to_socket.name == "Surface"), None)
            if surf:
                src = surf.from_socket; nt.links.remove(surf)
                tr = nt.nodes.new("ShaderNodeBsdfTransparent"); ms = nt.nodes.new("ShaderNodeMixShader")
                nt.links.new(img.outputs["Alpha"], ms.inputs[0]); nt.links.new(tr.outputs[0], ms.inputs[1]); nt.links.new(src, ms.inputs[2])
                nt.links.new(ms.outputs[0], out.inputs["Surface"])
            if hasattr(m, "blend_method"): m.blend_method = "HASHED"
            for n in nt.nodes:
                if n.type == "BSDF_PRINCIPLED" and "Roughness" in n.inputs: n.inputs["Roughness"].default_value = 0.62
    if spec.get("beard"):
        from mathutils.bvhtree import BVHTree
        dg = bpy.context.evaluated_depsgraph_get()
        body_bvh = BVHTree.FromObject(bm, dg)
        trim = float(spec.get("beard_trim", 0.5))
        for o in bpy.data.objects:
            if o.type == "MESH" and spec["beard"].lower() in o.name.lower():
                mw, mi = o.matrix_world, o.matrix_world.inverted()
                bmw_i = bm.matrix_world.inverted()
                for v in o.data.vertices:
                    wco = mw @ v.co
                    hit = body_bvh.find_nearest(bmw_i @ wco)
                    if hit[0] is None: continue
                    p = bm.matrix_world @ hit[0]
                    v.co = mi @ (p + (wco - p) * trim)
    hc = spec.get("hair_color")
    for o in bpy.data.objects:
        if o.type != "MESH": continue
        nm = o.name.lower()
        if (spec.get("hair") and spec["hair"].lower() in nm) or (spec.get("beard") and spec["beard"].lower() in nm):
            tint_cards(o, hc)
    if spec.get("eye_color"):
        ep = os.path.join(DATA, "eyes", "materials", spec["eye_color"] + "_eye.png")
        for o in bpy.data.objects:
            nm = o.name.lower()
            if o.type != "MESH" or "eye" not in nm or "brow" in nm or "lash" in nm: continue
            for slot in o.material_slots:
                m = slot.material
                if not m or not m.use_nodes or not os.path.exists(ep): continue
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image: n.image = bpy.data.images.load(ep)
''')


@mcp.tool()
def people_render(spec: dict, out: str = "", shot: str = "portrait", samples: int = 64, width: int = 768, height: int = 1024) -> dict:
    """Build one person with MPFB and render it in Cycles.
    spec: {gender 0..1 (1 male), age 0..1 (0.5 = 25 y, 1 = 90 y), muscle, weight, height 0..1,
           race {african, asian, caucasian} (weights), skin (a skins/ name), eyes, eyebrows,
           eye_color (brown | blue | green | grey ...), hair (a hair/ name), hair_color [r, g, b]
           (linear), beard (a clothes/ beard name), clothes [garments, shoes, hats], targets {path: value}}
    shot: portrait | body. Returns the PNG path."""
    out = out or os.path.join(OUT_DIR, f"person-{int(time.time())}.png")
    code = "SPEC = " + json.dumps(json.dumps(spec)) + "\n" + PERSON + textwrap.dedent(f'''
        scn = bpy.context.scene
        # a relaxed stance instead of MakeHuman's A-pose: each arm bone is aimed
        # (armature space: Z up, the person faces -Y) down along the body,
        # elbows a little bent
        import mathutils
        arm = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
        if arm:
            bpy.context.view_layer.update()
            def aim(pb, target):
                cur = (pb.tail - pb.head).normalized()
                q = cur.rotation_difference(mathutils.Vector(target).normalized())
                h = pb.head.copy()
                pb.matrix = mathutils.Matrix.Translation(h) @ q.to_matrix().to_4x4() @ mathutils.Matrix.Translation(-h) @ pb.matrix
                bpy.context.view_layer.update()
            for side, sg in (("l", 1), ("r", -1)):
                if ("upperarm_" + side) in arm.pose.bones:
                    aim(arm.pose.bones["upperarm_" + side], (0.2 * sg, 0.02, -0.98))
                    aim(arm.pose.bones["lowerarm_" + side], (0.08 * sg, -0.2, -0.97))
        scn.render.engine = "CYCLES"; scn.cycles.samples = {int(samples)}; scn.cycles.use_denoising = True
        try:
            scn.view_settings.view_transform = "AgX"; scn.view_settings.look = "AgX - Medium High Contrast"
        except Exception:
            pass
        scn.view_settings.exposure = -0.35
        scn.render.resolution_x, scn.render.resolution_y = {int(width)}, {int(height)}
        top = max((bm.matrix_world @ v.co).z for v in bm.data.vertices)
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); scn.collection.objects.link(cam); scn.camera = cam
        import mathutils
        if "{shot}" == "portrait":
            cam.data.lens = 85; tgt = mathutils.Vector((0, 0, top - 0.13)); cam.location = (0.25, -1.05, top - 0.1)
        else:
            cam.data.lens = 50; tgt = mathutils.Vector((0, 0, top * 0.52)); cam.location = (0.9, -3.6, top * 0.62)
        cam.rotation_euler = (tgt - cam.location).to_track_quat("-Z", "Y").to_euler()
        for loc, energy, size in [((-1.6, -2.0, top + 0.8), 210, 1.6), ((2.0, -1.2, top + 0.3), 60, 2.0), ((0.6, 2.2, top + 0.9), 150, 1.0)]:
            l = bpy.data.objects.new("L", bpy.data.lights.new("L", "AREA")); l.data.energy = energy; l.data.size = size
            l.location = loc; scn.collection.objects.link(l)
            l.rotation_euler = (mathutils.Vector((0, 0, top * 0.7)) - mathutils.Vector(loc)).to_track_quat("-Z", "Y").to_euler()
        w = bpy.data.worlds.new("w"); scn.world = w; w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.45, 0.5, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.35
        scn.render.filepath = {json.dumps(out)}
        bpy.ops.render.render(write_still=True)
        print("RENDERED", {json.dumps(out)})
    ''')
    r = _run(code, timeout=1800)
    r["png"] = out if os.path.exists(out) else None
    return r


@mcp.tool()
def people_export_glb(spec: dict, out: str) -> dict:
    """Build one person (same spec as people_render) with the game_engine skeleton and export it as
    a skinned GLB (textures embedded)."""
    code = "SPEC = " + json.dumps(json.dumps(spec)) + "\n" + PERSON + textwrap.dedent(f'''
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath={json.dumps(out)}, export_format="GLB", use_selection=True,
                                  export_skins=True, export_morph=True, export_apply=False)
        print("EXPORTED", {json.dumps(out)})
    ''')
    r = _run(code, timeout=900)
    r["glb"] = out if os.path.exists(out) else None
    return r


@mcp.tool()
def people_build_pack(k: int = 40) -> dict:
    """Rebuild assets/people (shape basis, rig, face targets, MHCLO assets, textures) from the installed
    MakeHuman data: the pack src/entities/people.js builds every ped from."""
    t0 = time.time()
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "people", "build_pack.py"), "--k", str(int(k)), "--data", USER_DATA],
                       capture_output=True, text=True, timeout=3600, cwd=ROOT)
    lines = (r.stdout + r.stderr).strip().splitlines()
    return {"ok": r.returncode == 0, "seconds": round(time.time() - t0, 1), "log": "\n".join(lines[-40:])}


if __name__ == "__main__":
    mcp.run()
