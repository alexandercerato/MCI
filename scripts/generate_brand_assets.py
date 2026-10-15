"""Build MCI's static share image and icons (requires Pillow and DejaVu fonts)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
ASSETS.mkdir(exist_ok=True)
FONT_DIR = Path('/usr/share/fonts/truetype/dejavu')
BG, PANEL, CYAN, WHITE, MUTED, GOLD = '#080c11', '#101923', '#63c6bf', '#f0f4f8', '#9aabba', '#d7a84f'
def font(size, bold=False):
    return ImageFont.truetype(str(FONT_DIR / ('DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf')), size)

def logo(size):
    im = Image.new('RGB', (size, size), BG)
    d = ImageDraw.Draw(im)
    m = size * .10
    d.rounded_rectangle((m, m, size-m, size-m), radius=size*.12, fill=PANEL, outline=CYAN, width=max(1, round(size*.016)))
    # A compact corridor motif above the wordmark.
    pts = [(size*.25,size*.31),(size*.5,size*.23),(size*.75,size*.31)]
    d.line(pts, fill=CYAN, width=max(2, round(size*.02)))
    for x,y in pts:
        r=size*.027
        d.ellipse((x-r,y-r,x+r,y+r),fill=GOLD if x==size*.5 else CYAN)
    d.text((size*.5,size*.59),'MCI',font=font(round(size*.27),True),fill=WHITE,anchor='mm')
    return im

# Supersampling keeps the original wordmark crisp at small icon sizes.
master=logo(768)
for filename,size in [('favicon.png',64),('apple-touch-icon.png',180)]:
    master.resize((size,size),Image.Resampling.LANCZOS).save(ASSETS / filename,optimize=True)

im=Image.new('RGB',(1200,630),BG)
d=ImageDraw.Draw(im)
d.rectangle((0,0,1200,9),fill=CYAN)
d.line([(68,557),(1132,557)],fill='#263749',width=2)
im.paste(master.resize((250,250),Image.Resampling.LANCZOS),(60,137))
d.text((352,150),'MIDDLE CORRIDOR',font=font(45,True),fill=WHITE)
d.text((352,213),'FREIGHT MONITOR',font=font(45,True),fill=WHITE)
d.text((354,300),'China → Caspian Sea → Türkiye',font=font(28),fill=CYAN)
d.text((354,354),'Freight rates · Port activity · Market news',font=font(22),fill=MUTED)
d.text((72,476),'MCFI-40',font=font(30,True),fill=WHITE)
d.text((285,480),'Full-route freight benchmark · USD / 40HC',font=font(23),fill=GOLD)
d.text((72,580),'INDEPENDENT CORRIDOR INTELLIGENCE',font=font(16),fill=MUTED)
im.save(ASSETS / 'mci-social-preview.png',optimize=True)

(ASSETS / 'mci-logo.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="MCI logo">
<rect width="256" height="256" rx="32" fill="#080c11"/>
<rect x="26" y="26" width="204" height="204" rx="31" fill="#101923" stroke="#63c6bf" stroke-width="4"/>
<path d="M64 79 128 59 192 79" fill="none" stroke="#63c6bf" stroke-width="5"/>
<g fill="#63c6bf"><circle cx="64" cy="79" r="7"/><circle cx="192" cy="79" r="7"/></g><circle cx="128" cy="59" r="7" fill="#d7a84f"/>
<text x="128" y="177" text-anchor="middle" font-family="DejaVu Sans,Arial,sans-serif" font-weight="bold" font-size="69" fill="#f0f4f8">MCI</text>
</svg>\n''')
