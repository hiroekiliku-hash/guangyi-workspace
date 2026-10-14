#!/usr/bin/env python3
"""Rebuild the original vector-style app mark (Pillow needed only for regeneration)."""
from pathlib import Path
import json
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'Shared/Assets.xcassets'
icon = root / 'AppIcon.appiconset'; icon.mkdir(parents=True, exist_ok=True)
canvas = Image.new('RGB', (1024, 1024), '#F6F7F2')
draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((168, 160, 856, 864), radius=160, fill='#304A40')
for offset, height in [(0, 370), (150, 460), (300, 290)]:
    x = 300 + offset
    draw.rounded_rectangle((x, 760 - height, x + 105, 760), radius=42, fill='#E0E9CC')
images = [{'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024', 'filename': 'AppIcon1024.png'}]
canvas.save(icon / 'AppIcon1024.png')
for size in [16, 32, 128, 256, 512]:
    for scale in [1, 2]:
        pixels = size * scale
        filename = f'AppIcon{pixels}.png'
        canvas.resize((pixels, pixels), Image.Resampling.LANCZOS).save(icon / filename)
        images.append({'idiom': 'mac', 'size': f'{size}x{size}', 'scale': f'{scale}x', 'filename': filename})
(icon / 'Contents.json').write_text(json.dumps({'images': images, 'info': {'author': 'xcode', 'version': 1}}, indent=2))
(root / 'Contents.json').write_text(json.dumps({'info': {'author': 'xcode', 'version': 1}}, indent=2))
print('Generated shared iPhone / Mac app icon catalog')
