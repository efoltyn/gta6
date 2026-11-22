import json, sys, math
from PIL import Image, ImageDraw, ImageFont
import os
G=os.environ.get('CITYMAP_OUT','/Users/elifoltyn/harness/out/gta6/citymap/')
o=json.load(open(G+'map.json'))
B=o['bounds']; S=float(sys.argv[1]) if len(sys.argv)>1 else 6.0   # metres per pixel
W=int((B['maxX']-B['minX'])/S); H=int((B['maxZ']-B['minZ'])/S)
def px(x,z): return ((x-B['minX'])/S,(z-B['minZ'])/S)
g=o['grid']; nx,nz,st=g['nx'],g['nz'],g['step']
base=Image.new('RGB',(nx,nz))
bp=base.load()
Hh=g['H']; Wt=g['W']
for j in range(nz):
    for i in range(nx):
        h=Hh[j*nx+i]; w=Wt[j*nx+i]
        if w==1: c=(52,92,140)
        elif w==2: c=(70,130,180)
        else:
            # hillshade from west
            hl=Hh[j*nx+max(0,i-1)]; hu=Hh[max(0,j-1)*nx+i]
            sh=max(-1,min(1,((h-hl)+(h-hu))/14.0))
            t=max(0,min(1,h/260.0))
            r=int(150+70*t+40*sh); gg=int(170+40*t+40*sh)-int(20*t); b=int(120+90*t+40*sh)
            if h>170: r,gg,b=int(225+25*sh),int(228+25*sh),int(232+22*sh)
            c=(max(0,min(255,r)),max(0,min(255,gg)),max(0,min(255,b)))
        bp[i,j]=c
im=base.resize((W,H),Image.BILINEAR)
d=ImageDraw.Draw(im,'RGBA')
try: F=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf',max(10,int(70/S))); Fs=ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial.ttf',max(8,int(48/S)))
except Exception: F=Fs=ImageFont.load_default()
BIO={'desert':(214,180,110,90),'forest':(40,110,50,90),'farmland':(190,200,90,90),'snow':(240,244,250,110),'wilds':(0,0,0,0),'airport':(120,120,130,110),'military':(110,120,80,120),'speedway':(150,110,110,110)}
for r in o['regions']:
    col=BIO.get(r.get('b'),(200,90,160,60))
    if r.get('k')=='circle' and r.get('r'):
        a=px(r['cx']-r['r'],r['cz']-r['r']); b=px(r['cx']+r['r'],r['cz']+r['r'])
        d.ellipse([a[0],a[1],b[0],b[1]],fill=col,outline=(60,60,60,160))
    elif r.get('x0') is not None:
        a=px(r['x0'],r['z0']); b=px(r['x1'],r['z1'])
        d.rectangle([a[0],a[1],b[0],b[1]],fill=col,outline=(60,60,60,140))
for r in o['roads']+o['frontier']:
    hw=max(1,r['w']/2)
    if r['v']: a=px(r['x']-hw,r['z']-r['len']/2); b=px(r['x']+hw,r['z']+r['len']/2)
    else: a=px(r['x']-r['len']/2,r['z']-hw); b=px(r['x']+r['len']/2,r['z']+hw)
    d.rectangle([a[0],a[1],max(b[0],a[0]+1),max(b[1],a[1]+1)],fill=(70,70,74,255))
for h in o['net']:
    p=[px(q[0],q[1]) for q in h['pts']]
    if len(p)>1: d.line(p,fill=(240,120,20,255),width=max(2,int(26/S)))
for h in o['highways']:
    p=[px(q[0],q[1]) for q in h['pts']]
    if len(p)>1: d.line(p,fill=(250,210,40,255),width=max(2,int(22/S)))
for f in o['foot']:
    a=px(f[0],f[1]); b=px(f[2],f[3])
    d.rectangle([a[0],a[1],max(b[0],a[0]+1),max(b[1],a[1]+1)],fill=(170,30,30,255))
# names: one per region, skip tiny
seen=set()
for r in o['regions']:
    n=r.get('n') or ''
    if not n or n in seen or 'bridge' in n.lower(): continue
    seen.add(n)
    if r.get('k')=='circle' and r.get('r'): c=px(r['cx'],r['cz']); size=r['r']*2
    elif r.get('x0') is not None: c=px((r['x0']+r['x1'])/2,(r['z0']+r['z1'])/2); size=min(r['x1']-r['x0'],r['z1']-r['z0'])
    else: continue
    if size<180: continue
    f=F if size>700 else Fs
    d.text((c[0]+1,c[1]+1),n,font=f,fill=(255,255,255,220),anchor='mm'); d.text(c,n,font=f,fill=(10,10,10,255),anchor='mm')
# grid every 1 km
for x in range(int(B['minX']//1000)*1000,int(B['maxX']),1000):
    a=px(x,B['minZ']); d.line([a[0],0,a[0],H],fill=(0,0,0,40)); d.text((a[0]+3,3),str(x),font=Fs,fill=(0,0,0,200))
for z in range(int(B['minZ']//1000)*1000,int(B['maxZ']),1000):
    a=px(B['minX'],z); d.line([0,a[1],W,a[1]],fill=(0,0,0,40)); d.text((3,a[1]+3),str(z),font=Fs,fill=(0,0,0,200))
im.save(G+'map-full.png')
sm=im.resize((1500,int(1500*H/W)),Image.LANCZOS); sm.save(G+'map-small.jpg',quality=88)
print(W,H)
