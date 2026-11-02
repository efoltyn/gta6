#!/usr/bin/env bash
# tools/blender/setup.sh — the Blender people toolchain, headless, idempotent.
#
#   Blender 4.5 LTS          -> /opt/blender            (official tarball)
#   MPFB 2 (MakeHuman for Blender, GPL extension)  -> Blender's user extensions
#                               + an unpacked copy at /opt/mh/mpfb (the base
#                               mesh, targets, rigs and weights the pack
#                               exporter reads straight off disk)
#   MakeHuman asset packs, CC0 only (skins, hair, eyebrows, eyelashes, body
#   parts incl. beards, garments, shoes, hats, glasses, eye and hair
#   materials) + the faceunits01 ARKit expression targets (CC0)
#                            -> MPFB's user data dir
#
# Then:  python3 tools/people/build_pack.py   (assets/people, what the game loads)
#        python3 tools/blender/mcp_server.py  (the MCP server, see .mcp.json)
#
# Re-running skips whatever is already there. Needs curl, unzip, xz, python3
# (+ pip install mcp numpy pillow for the server and the exporter).
set -euo pipefail

BLV=4.5.15
BL=/opt/blender
MH=/opt/mh
EXT=$HOME/.config/blender/4.5/extensions
DATA=$EXT/.user/user_default/mpfb/data
mkdir -p "$MH/packs" "$DATA"

# ---- Blender -----------------------------------------------------------------
if [ ! -x "$BL/blender" ]; then
  echo "== Blender $BLV"
  curl -fsSL "https://download.blender.org/release/Blender4.5/blender-$BLV-linux-x64.tar.xz" -o /tmp/blender.tar.xz
  tar -xJf /tmp/blender.tar.xz -C /opt && rm -f /tmp/blender.tar.xz
  rm -rf "$BL" && mv "/opt/blender-$BLV-linux-x64" "$BL"
fi
"$BL/blender" -b --factory-startup --version | head -1

# ---- MPFB --------------------------------------------------------------------
if [ ! -d "$EXT/user_default/mpfb" ]; then
  echo "== MPFB"
  if [ -n "${MPFB_ZIP:-}" ] && [ -s "$MPFB_ZIP" ]; then
    cp "$MPFB_ZIP" "$MH/mpfb.zip"
  else
    # the extension from the official Blender extensions platform
    "$BL/blender" -b --factory-startup --command extension sync
    "$BL/blender" -b --factory-startup --command extension install --enable mpfb
  fi
  [ -s "$MH/mpfb.zip" ] && "$BL/blender" -b --factory-startup --command extension install-file -r user_default --enable "$MH/mpfb.zip"
fi
if [ ! -d "$MH/mpfb/data/3dobjs" ]; then
  if [ -s "$MH/mpfb.zip" ]; then rm -rf "$MH/mpfb" && mkdir -p "$MH/mpfb" && unzip -q "$MH/mpfb.zip" -d "$MH/mpfb"
  else rm -rf "$MH/mpfb" && cp -r "$EXT/user_default/mpfb" "$MH/mpfb"; fi
fi

# ---- MakeHuman asset packs (CC0 only) --------------------------------------
cd "$MH/packs"
for spec in \
  makehuman_system_assets/makehuman_system_assets_cc0 skins01/skins01_cc0 skins02/skins02_cc0 \
  eyebrows01/eyebrows01_cc0 eyelashes01/eyelashes01_cc0 bodyparts04/bodyparts04_cc0 bodyparts05/bodyparts05_cc0 \
  shirts01/shirts01_cc0 pants01/pants01_cc0 shoes01/shoes01_cc0 suits01/suits01_cc0 dress01/dress01_cc0 \
  skirts01/skirts01_cc0 hats01/hats01_cc0 hats02/hats02_cc0 glasses01/glasses01_cc0 gloves01/gloves01_cc0 \
  masks01/masks01_cc0 underwear01/underwear01_cc0 hair01/hair01_cc0 equipment01/equipment01_cc0 jewelry01/jewelry01_cc0 \
  system_eye_materials01/system_eye_materials01_cc0 system_eye_materials02/system_eye_materials02_cc0 \
  system_hair_materials01/system_hair_materials01_cc0 system_hair_materials02/system_hair_materials02_cc0 \
  system_clothes_materials01/system_clothes_materials01_cc0 clothes_materials01/clothes_materials01_cc0 ; do
  f=$(basename "$spec").zip
  [ -s "$f" ] && continue
  for host in files.makehumancommunity.org files2.makehumancommunity.org; do
    if curl -fsSL --max-time 900 -o "$f.part" "https://$host/asset_packs/$spec.zip" && unzip -tq "$f.part" >/dev/null 2>&1; then
      mv "$f.part" "$f"; echo "got $f"; break
    fi
    rm -f "$f.part"
  done
done
[ -s faceunits01.zip ] || curl -fsSL --max-time 300 -o faceunits01.zip "https://files.makehumancommunity.org/functional/faceunits01.zip"

# ---- install into MPFB's user data (what MPFB's own "load pack" does) ------
python3 - "$MH/packs" "$DATA" <<'PY'
import os, sys, zipfile, shutil, tempfile
packs, data = sys.argv[1], sys.argv[2]
root = os.path.dirname(data)
for f in sorted(os.listdir(packs)):
    if not f.endswith(".zip"):
        continue
    mark = os.path.join(data, ".installed-" + f)
    if os.path.exists(mark):
        continue
    with zipfile.ZipFile(os.path.join(packs, f)) as z:
        if f.startswith("faceunits"):
            # the functional face units sit beside the data dir, as MPFB keeps them
            z.extractall(os.path.join(root, "functional_" + f[:-4]))
        else:
            tmp = tempfile.mkdtemp()
            z.extractall(tmp)
            src = tmp
            if "packs" not in os.listdir(tmp):
                dirs = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d)) and not d.startswith("__")]
                if len(dirs) == 1:
                    src = os.path.join(tmp, dirs[0])
            for e in os.listdir(src):
                if e.startswith(".") or e == "__MACOSX":
                    continue
                s, d = os.path.join(src, e), os.path.join(data, e)
                if os.path.isdir(s):
                    shutil.copytree(s, d, dirs_exist_ok=True)
                else:
                    shutil.copy2(s, d)
            shutil.rmtree(tmp, ignore_errors=True)
    open(mark, "w").close()
    print("installed", f)
PY

echo "== ready: $(ls "$DATA/hair" 2>/dev/null | wc -l) hair, $(ls "$DATA/clothes" 2>/dev/null | wc -l) clothes, $(ls "$DATA/skins" 2>/dev/null | wc -l) skins"
