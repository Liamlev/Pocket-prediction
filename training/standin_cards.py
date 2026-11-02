"""Stand-in card faces so the pipeline can be tested before the real Bicycle photos arrive.
Writes cards/<CODE>.png (500x700) and cards/index.json with the corner-index box as fractions."""
import json, os
from PIL import Image, ImageDraw, ImageFont

RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
SUITS = {'C': '♣', 'D': '♦', 'H': '♥', 'S': '♠'}
W, H = 500, 700
INDEX = (0.02, 0.02, 0.17, 0.31)   # top-left index box (x0, y0, x1, y1) as fractions of the card

os.makedirs('cards', exist_ok=True)
rank_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 62)
suit_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 60)
pip_font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 120)

def corner(img, r, s, col):
    d = ImageDraw.Draw(img)
    cx = int(W * (INDEX[0] + INDEX[2]) / 2)
    d.text((cx, int(H * 0.035)), r, font=rank_font, fill=col, anchor='mt')
    d.text((cx, int(H * 0.16)), SUITS[s], font=suit_font, fill=col, anchor='mt')

for s in SUITS:
    for r in RANKS:
        col = (200, 20, 30) if s in 'DH' else (15, 15, 15)
        img = Image.new('RGB', (W, H), (248, 246, 240))
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((2, 2, W - 3, H - 3), radius=28, outline=(180, 180, 180), width=3)
        corner(img, r, s, col)
        img = img.rotate(180); corner(img, r, s, col); img = img.rotate(180)
        d = ImageDraw.Draw(img)
        d.text((W // 2, H // 2), SUITS[s], font=pip_font, fill=col, anchor='mm')
        img.save(f'cards/{r}{s}.png')
json.dump({'index': INDEX}, open('cards/index.json', 'w'))
print('ok', len(os.listdir('cards')))
