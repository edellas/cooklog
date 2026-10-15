"""Grafica in evidenza per Google Play (1024x500, obbligatoria).

Uso: python3 scripts/make-feature-graphic.py  (richiede Pillow). Scrive store/grafica/play-grafica-1024x500.png.
Masthead "Virale" in Bodoni, la riga della promessa, e tre foto della demo come una pagina di provini,
con la matita rossa che ne cerchia una.
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from importlib import import_module

icons = import_module('make-icons')
ROOT = icons.ROOT
W, H, S = 1024, 500, 2
BODONI = icons.FONT
SANS = os.path.join(ROOT, 'node_modules/@expo-google-fonts/schibsted-grotesk/500Medium/SchibstedGrotesk_500Medium.ttf')
DEMO = os.path.join(ROOT, 'assets/demo')


def photo(name, w, h):
    im = Image.open(os.path.join(DEMO, name)).convert('RGB')
    return ImageOps.fit(im, (w, h), Image.LANCZOS)


def rounded(im, r):
    m = Image.new('L', im.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, im.size[0] - 1, im.size[1] - 1), r, fill=255)
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    out.paste(im, (0, 0), m)
    return out


def main():
    img = Image.new('RGBA', (W * S, H * S), icons.CANVAS + (255,))
    d = ImageDraw.Draw(img)

    # Tre provini inclinati appena, a destra.
    names = sorted(f for f in os.listdir(DEMO) if f.lower().endswith('.jpg'))
    pick = [n for n in ('gatto-neve.jpg', 'cinqueterre.jpg', 'succo.jpg') if n in names] or names[:3]
    cw, ch = 160 * S, 250 * S
    spots = [(590, 140, -6), (812, 150, 5), (700, 105, 2)]  # quella cerchiata per ultima, sopra le altre
    order = [pick[0], pick[2], pick[1]]
    for i, (n, (x, y, rot)) in enumerate(zip(order, spots)):
        card = Image.new('RGBA', (cw + 14 * S, ch + 14 * S), icons.PAPER + (255,))
        card = rounded(card, 16 * S)
        card.alpha_composite(rounded(photo(n, cw, ch).convert('RGBA'), 11 * S), (7 * S, 7 * S))
        card = card.rotate(rot, Image.BICUBIC, expand=True)
        img.alpha_composite(card, (x * S, y * S))
        if i == 2:
            cx, cy = x * S + card.size[0] // 2, y * S + card.size[1] // 2
            icons.pencil_oval(d, cx, cy, 108 * S, 160 * S, 6 * S, icons.MATITA, tilt=-8)

    # Sfumatura per staccare il testo dalle foto.
    shade = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shade)
    for x in range(560 * S):
        a = 255 if x < 470 * S else max(0, int(255 * (1 - (x - 470 * S) / (130 * S))))
        sd.line([(x, 0), (x, H * S)], fill=icons.CANVAS + (a,))
    img = Image.alpha_composite(img, shade)
    d = ImageDraw.Draw(img)

    title = ImageFont.truetype(BODONI, 128 * S)
    d.text((56 * S, 86 * S), 'Virale', font=title, fill=icons.PAPER)
    sans = ImageFont.truetype(SANS, 30 * S)
    d.text((60 * S, 275 * S), 'Ogni giorno una sola copertina.', font=sans, fill=icons.PAPER)
    d.text((60 * S, 320 * S), 'La scelgono gli occhi di tutti.', font=sans, fill=(193, 200, 213))
    d.rounded_rectangle((60 * S, 392 * S, 330 * S, 448 * S), 28 * S, fill=icons.GIALLO)
    small = ImageFont.truetype(SANS, 24 * S)
    d.text((195 * S, 420 * S), 'Foto e video, gratis', font=small, fill=icons.CANVAS, anchor='mm')

    out = os.path.join(ROOT, 'store/grafica/play-grafica-1024x500.png')
    img.resize((W, H), Image.LANCZOS).convert('RGB').save(out, optimize=True)
    print('Scritto', out)


if __name__ == '__main__':
    main()
