"""Impacchetta la build web di Virale (modalità demo) in un'unica pagina HTML cliccabile.

Uso:
  npx expo export --platform web --output-dir /tmp/virale-web
  python3 scripts/make-anteprima.py /tmp/virale-web anteprima.html

Tutto finisce dentro il file: codice, font, foto e video della demo diventano data URI, così la
pagina funziona da sola, ovunque la si apra. Su schermi larghi l'app sta in una cornice da telefono,
con accanto le cose da provare; su un telefono occupa tutto lo schermo.
"""
import base64
import glob
import mimetypes
import os
import re
import sys

SRC, OUT = sys.argv[1], sys.argv[2]
USED_FONTS = {'BodoniModa_500Medium', 'BodoniModa_700Bold', 'BodoniModa_900Black',
              'SchibstedGrotesk_400Regular', 'SchibstedGrotesk_500Medium', 'SchibstedGrotesk_700Bold'}
MIME = {'.ttf': 'font/ttf', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png'}

bundle_path = glob.glob(os.path.join(SRC, '_expo/static/js/web/entry-*.js'))[0]
js = open(bundle_path, encoding='utf-8').read()


def inline(m):
    url = m.group(1)
    name = os.path.basename(url)
    if url.endswith('.ttf') and name.split('.')[0] not in USED_FONTS:
        return '""'  # pesi che l'app non usa: non si caricano mai
    path = os.path.join(SRC, url.lstrip('/'))
    ext = os.path.splitext(path)[1]
    mime = MIME.get(ext) or mimetypes.guess_type(path)[0] or 'application/octet-stream'
    return '"data:%s;base64,%s"' % (mime, base64.b64encode(open(path, 'rb').read()).decode())


js, n = re.subn(r'"(/assets/[^"]+\.(?:ttf|mp4|jpg|png))"', inline, js)
js = js.replace('</script', '<\\/script').replace('<!--', '<\\!--')

page = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'anteprima-cornice.html'), encoding='utf-8').read()
out = page.replace('/*BUNDLE*/', js)
open(OUT, 'w', encoding='utf-8').write(out)
print('%d risorse incorporate · %.1f MB · %s' % (n, len(out.encode()) / 1e6, OUT))
