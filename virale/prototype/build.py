"""Compila il prototipo in un unico file HTML autosufficiente.

Incorpora le foto demo (ridotte a 480x720) e i video (WebM VP9 + MP4 H.264, così si
riproducono in ogni browser) come data URI. Uso: python3 prototype/build.py
Richiede Pillow e ffmpeg. Output: prototype/dist/virale-prototipo.html
"""
import base64
import io
import json
import os
import subprocess
import tempfile

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.join(HERE, '..', 'assets', 'demo')
DIST = os.path.join(HERE, 'dist')


def data_uri(mime: str, raw: bytes) -> str:
    return f'data:{mime};base64,{base64.b64encode(raw).decode()}'


def image(path: str) -> str:
    im = Image.open(path).convert('RGB').resize((480, 720), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=68, optimize=True, progressive=True)
    return data_uri('image/jpeg', buf.getvalue())


def video(path: str) -> dict:
    out = {}
    with tempfile.TemporaryDirectory() as tmp:
        webm, mp4 = os.path.join(tmp, 'v.webm'), os.path.join(tmp, 'v.mp4')
        common = ['ffmpeg', '-y', '-loglevel', 'error', '-i', path, '-vf', 'scale=400:600', '-an']
        subprocess.run(common + ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', webm], check=True)
        subprocess.run(common + ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '30', '-movflags', '+faststart', mp4], check=True)
        out['webm'] = data_uri('video/webm', open(webm, 'rb').read())
        out['mp4'] = data_uri('video/mp4', open(mp4, 'rb').read())
    return out


def main() -> None:
    media, videos = {}, {}
    for name in sorted(os.listdir(DEMO)):
        stem, ext = os.path.splitext(name)
        if ext == '.jpg':
            media[stem] = image(os.path.join(DEMO, name))
        elif ext == '.mp4':
            videos[stem] = video(os.path.join(DEMO, name))
    template = open(os.path.join(HERE, 'index.html'), encoding='utf-8').read()
    payload = f'window.MEDIA = {json.dumps(media)};\nwindow.VIDEO = {json.dumps(videos)};'
    html = template.replace('/*__MEDIA__*/', payload, 1)
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, 'virale-prototipo.html')
    open(out, 'w', encoding='utf-8').write(html)
    print(f'{out}: {len(html) / 1e6:.2f} MB, {len(media)} foto, {len(videos)} video')


if __name__ == '__main__':
    main()
