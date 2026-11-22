"""tools/citymap/crop.py: cut a piece of map-full.png by WORLD coordinates.

  python3 tools/citymap/crop.py x0 z0 x1 z1 [out.png] [max pixel width, default 1500]

Reads map.json for the bounds and map-full.png for the picture (both in
CITYMAP_OUT), so the crop is in metres: x east, z south, same as the game."""
import json, os, sys
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
G = os.environ.get('CITYMAP_OUT', '/Users/elifoltyn/harness/out/gta6/citymap/')
B = json.load(open(G + 'map.json'))['bounds']
x0, z0, x1, z1 = [float(v) for v in sys.argv[1:5]]
out = sys.argv[5] if len(sys.argv) > 5 else G + 'crop.png'
maxw = int(sys.argv[6]) if len(sys.argv) > 6 else 1500
im = Image.open(G + 'map-full.png')
S = (B['maxX'] - B['minX']) / im.size[0]
box = (int((x0 - B['minX']) / S), int((z0 - B['minZ']) / S), int((x1 - B['minX']) / S), int((z1 - B['minZ']) / S))
c = im.crop(box)
if c.size[0] > maxw: c = c.resize((maxw, int(c.size[1] * maxw / c.size[0])), Image.LANCZOS)
elif c.size[0] < 700: c = c.resize((c.size[0] * 2, c.size[1] * 2), Image.NEAREST)
c.save(out)
print(out, c.size, '%.2f m/px in the source' % S)
