"""Render the approved custom MCI wordmark as native SVG and PNG brand assets.

Requires Inkscape. One set of vector geometry serves the website, square share
image, rectangular export and small-size icons.
"""
from pathlib import Path
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
INK = '#111111'
SAGE = '#365f51'
GEOMETRY = json.loads((ASSETS / 'mci-wordmark-geometry.json').read_text())

def svg(viewbox, subtitle=True):
    signature = f'<path d="{GEOMETRY["signature"]}"/>' if subtitle else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="MCI - Middle Corridor Freight Index">
<title>MCI - Middle Corridor Freight Index</title>
<rect x="0" y="0" width="1254" height="1254" fill="#ffffff"/>
<g fill="{INK}" fill-rule="evenodd" transform="translate(0 {GEOMETRY['height']}) scale(1 -1)">
<path d="{GEOMETRY['wordmark']}"/>
{signature}
</g>
<path d="M371 408H884" fill="none" stroke="{INK}" stroke-width="4.5"/>
<circle cx="371" cy="408" r="24.5" fill="{INK}"/>
<circle cx="627.5" cy="408" r="24.5" fill="{SAGE}"/>
<circle cx="884" cy="408" r="24.5" fill="{INK}"/>
</svg>
'''

sources = {
    'mci-logo.svg': ('0 0 1254 1254', True),
    'mci-logo-horizontal.svg': ('160 350 930 580', True),
    'mci-logo-rectangular.svg': ('0 325 1254 627', True),
    'mci-icon.svg': ('160 150 930 930', False),
}
for name, (viewbox, subtitle) in sources.items():
    (ASSETS / name).write_text(svg(viewbox, subtitle), encoding='utf-8')

inkscape = shutil.which('inkscape')
if not inkscape:
    raise SystemExit('Inkscape is required to render the vector brand assets.')
for source, target, width in [
    ('mci-logo.svg', 'mci-social-logo-square.png', 1200),
    ('mci-logo-rectangular.svg', 'mci-logo-rectangular.png', 2400),
    ('mci-logo.svg', 'apple-touch-icon.png', 180),
    ('mci-icon.svg', 'favicon.png', 64),
]:
    subprocess.run([inkscape, str(ASSETS/source), '--export-type=png',
                    '--export-filename='+str(ASSETS/target),
                    '--export-width='+str(width)],
                   check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
print('Rendered square, rectangular, navigation and small-size MCI assets.')
