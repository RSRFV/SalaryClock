from PIL import Image, ImageDraw
import os

BASE = os.path.join(os.path.dirname(__file__), '..', 'res')
SIZES = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
LIME = (200, 247, 81, 255)
BG = (11, 15, 20, 255)

for dens, size in SIZES.items():
    S = size * 4
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=BG)

    cx = cy = S // 2
    rad = int(S * 0.29)
    w = max(2, int(S * 0.055))
    d.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=LIME, width=w)
    d.line([cx, cy, cx, cy - int(rad * 0.62)], fill=LIME, width=w)
    d.line([cx, cy, cx + int(rad * 0.48), cy + int(rad * 0.3)], fill=LIME, width=w)
    d.ellipse([cx - w // 2, cy - w // 2, cx + w // 2, cy + w // 2], fill=LIME)

    img = img.resize((size, size), Image.LANCZOS)
    out = os.path.join(BASE, 'mipmap-' + dens)
    os.makedirs(out, exist_ok=True)
    img.save(os.path.join(out, 'ic_launcher.png'))

print('icons generated')
