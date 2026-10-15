"""Genera icona, icona adattiva Android, icona monocromatica, splash e favicon di Virale.

Uso: python3 scripts/make-icons.py  (richiede Pillow). Scrive in assets/ e store/.
La "V" in Bodoni Moda Black cerchiata dalla matita rossa: il gesto con cui nell'app si sceglie un post.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
FONT = os.path.join(ROOT, 'node_modules/@expo-google-fonts/bodoni-moda/900Black/BodoniModa_900Black.ttf')
CANVAS = (12, 19, 34)      # oklch(0.19 0.032 264)
PAPER = (245, 243, 238)    # oklch(0.965 0.008 95)
MATITA = (246, 80, 65)     # oklch(0.66 0.205 29)
GIALLO = (250, 219, 44)    # oklch(0.89 0.175 98)
S = 4                      # supersampling per bordi puliti


def pencil_oval(draw, cx, cy, rx, ry, width, color, tilt=-12):
    """Ovale tracciato a mano: parte in alto a destra, fa un giro e un po' e si sovrappone al tratto iniziale."""
    pts = []
    start, end = math.radians(-60), math.radians(-60 + 395)
    steps = 900
    for i in range(steps + 1):
        t = start + (end - start) * i / steps
        grow = 1 + 0.07 * (i / steps)   # il secondo passaggio è un po' più largo, come a mano libera
        x, y = rx * grow * math.cos(t), ry * grow * math.sin(t)
        a = math.radians(tilt)
        pts.append((cx + x * math.cos(a) - y * math.sin(a), cy + x * math.sin(a) + y * math.cos(a)))
    for i, (x, y) in enumerate(pts):
        # il tratto si assottiglia all'inizio e alla fine, come la pressione della matita
        k = min(1.0, i / 60, (len(pts) - 1 - i) / 60)
        r = width / 2 * (0.55 + 0.45 * k)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def mark(size, bg, letter_color, oval_color, scale=1.0, transparent=False):
    big = size * S
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0) if transparent else bg + (255,))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(big * 0.60 * scale))
    # "V" centrata otticamente (il Bodoni ha la grazia larga in alto)
    box = d.textbbox((0, 0), 'V', font=font)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((big - w) / 2 - box[0], (big - h) / 2 - box[1] + big * 0.02 * scale), 'V', font=font, fill=letter_color)
    if oval_color:
        pencil_oval(d, big / 2, big * 0.515, big * 0.36 * scale, big * 0.30 * scale, big * 0.045 * scale, oval_color)
    return img.resize((size, size), Image.LANCZOS)


def masthead(width, color):
    big = width * S
    font = ImageFont.truetype(FONT, int(big * 0.24))
    tmp = Image.new('RGBA', (big, big // 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    box = d.textbbox((0, 0), 'Virale', font=font)
    d.text(((big - (box[2] - box[0])) / 2 - box[0], (big // 2 - (box[3] - box[1])) / 2 - box[1]), 'Virale', font=font, fill=color)
    return tmp.resize((width, width // 2), Image.LANCZOS)


def main():
    assets = os.path.join(ROOT, 'assets')
    store = os.path.join(ROOT, 'store', 'grafica')
    os.makedirs(store, exist_ok=True)
    # iOS: 1024x1024 opaca, senza trasparenza né angoli (li arrotonda il sistema)
    mark(1024, CANVAS, PAPER, MATITA).convert('RGB').save(os.path.join(assets, 'icon.png'))
    # Android adattiva: primo piano trasparente con il segno nella zona sicura (66%), fondo dal colore in app.json
    mark(1024, CANVAS, PAPER, MATITA, scale=0.66, transparent=True).save(os.path.join(assets, 'adaptive-icon.png'))
    # Android 13+, icone a tema: solo forma, in un colore
    mark(1024, CANVAS, (255, 255, 255), (255, 255, 255), scale=0.66, transparent=True).save(os.path.join(assets, 'adaptive-icon-monochrome.png'))
    # Splash: la testata su fondo d'inchiostro (il colore di fondo è in app.json)
    masthead(1024, PAPER).save(os.path.join(assets, 'splash-icon.png'))
    mark(196, CANVAS, PAPER, MATITA).convert('RGB').save(os.path.join(assets, 'favicon.png'))
    # Google Play: icona 512x512
    mark(512, CANVAS, PAPER, MATITA).convert('RGB').save(os.path.join(store, 'play-icona-512.png'))
    print('ok: assets/icon.png, adaptive-icon.png, adaptive-icon-monochrome.png, splash-icon.png, favicon.png, store/grafica/play-icona-512.png')


if __name__ == '__main__':
    main()
