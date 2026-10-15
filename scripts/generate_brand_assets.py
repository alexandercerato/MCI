"""Build MCI's static share image and icons (requires Pillow and DejaVu fonts)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
BG, PANEL, CYAN, WHITE, MUTED, GOLD = '#ffffff', '#ffffff', '#365f51', '#111111', '#677269', '#111111'
BORDER = '#d5dfd9'
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)

def logo(size):
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    m = size * .10
    d.rounded_rectangle((m, m, size-m, size-m), radius=size*.12, fill=PANEL, outline=BORDER, width=max(1, round(size*.016)))
    # A compact corridor motif above the wordmark.
    pts = [(size*.25,size*.35),(size*.5,size*.28),(size*.75,size*.35)]
    d.line(pts, fill=CYAN, width=max(2, round(size*.02)))
    for x,y in pts:
        r=size*.027
        d.ellipse((x-r,y-r,x+r,y+r),fill=GOLD if x==size*.5 else CYAN)
    d.text((size*.5,size*.54),'MCI',font=font(round(size*.27),True),fill=WHITE,anchor='mm')
    d.text((size*.5,size*.73),'MCFI-40',font=font(round(size*.075),True),fill=GOLD,anchor='mm')
    return im

# Supersampling keeps the original wordmark crisp at small icon sizes.
master=logo(768)
for filename,size in [('favicon.png',64),('apple-touch-icon.png',180)]:
    master.resize((size,size),Image.Resampling.LANCZOS).save(ASSETS / filename,optimize=True)

# A square logo only: no banner, title or promotional copy.
logo(1200).save(ASSETS / 'mci-social-logo-square.png',optimize=True)

(ASSETS / 'mci-logo.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="MCI logo">
<rect width="256" height="256" rx="32" fill="#ffffff"/>
<rect x="26" y="26" width="204" height="204" rx="31" fill="#ffffff" stroke="#d5dfd9" stroke-width="4"/>
<path d="M64 90 128 72 192 90" fill="none" stroke="#365f51" stroke-width="5"/>
<g fill="#365f51"><circle cx="64" cy="90" r="7"/><circle cx="192" cy="90" r="7"/></g><circle cx="128" cy="72" r="7" fill="#111111"/>
<text x="128" y="160" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="69" fill="#111111">MCI</text>
<text x="128" y="197" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="19" fill="#111111">MCFI-40</text>
</svg>\n''')
