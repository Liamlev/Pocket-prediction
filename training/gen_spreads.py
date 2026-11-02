"""Synthetic training scenes for the card reader: ribbon spreads (straight and curved, either
direction, tight or loose), loose cards and single close-up cards, on varied backgrounds and
lighting. Every corner index that stays visible gets a YOLO label.

usage: python gen_spreads.py CARD_DIR OUT_DIR COUNT [SEED]
CARD_DIR holds <CODE>.png card faces (upright, cropped to the card) and index.json."""
import json, math, os, random, sys
import cv2
import numpy as np

NAMES = ['10C','10D','10H','10S','2C','2D','2H','2S','3C','3D','3H','3S','4C','4D','4H','4S','5C','5D','5H','5S',
         '6C','6D','6H','6S','7C','7D','7H','7S','8C','8D','8H','8S','9C','9D','9H','9S','AC','AD','AH','AS','JC','JD','JH','JS',
         'KC','KD','KH','KS','QC','QD','QH','QS']
S = 640

def load_cards(d):
    idx = json.load(open(os.path.join(d, 'index.json')))['index']
    cards = {}
    for n in NAMES:
        p = os.path.join(d, n + '.png')
        if os.path.exists(p):
            im = cv2.imread(p, cv2.IMREAD_COLOR)
            cards[n] = cv2.resize(im, (500, 700), interpolation=cv2.INTER_AREA)
    return cards, idx

def background(rng):
    kind = rng.random()
    base = np.array([rng.uniform(0, 255) for _ in range(3)], np.float32)
    if kind < 0.35:                                   # felt / fabric: fine noise
        bg = base + rng.uniform(5, 30) * np.random.randn(S, S, 3).astype(np.float32)
        bg = cv2.GaussianBlur(bg, (0, 0), rng.uniform(0.5, 2))
    elif kind < 0.6:                                  # wood-ish stripes
        x = np.linspace(0, rng.uniform(5, 40), S)[None, :] + 0.3 * np.random.randn(S, S).cumsum(0) / S * 20
        stripes = (np.sin(x) * 0.5 + 0.5)[..., None]
        bg = base * (0.7 + 0.5 * stripes)
    elif kind < 0.8:                                  # smooth gradient
        g = np.linspace(rng.uniform(0.6, 1), rng.uniform(0.6, 1.3), S)[:, None, None]
        bg = np.broadcast_to(base * g, (S, S, 3)).copy()
    else:                                             # blotchy (tablecloth, sofa)
        n = cv2.resize(np.random.rand(8, 8, 3).astype(np.float32), (S, S), interpolation=cv2.INTER_CUBIC)
        bg = base * 0.6 + n * rng.uniform(40, 140)
    return np.clip(bg, 0, 255).astype(np.uint8)

def place(canvas, owner, card, cid, center, angle_deg, ch):
    """Draw card (height ch px) centred at center, rotated; record pixel ownership. Returns 2x3 affine."""
    h, w = card.shape[:2]
    sc = ch / h
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle_deg, sc)
    M[0, 2] += center[0] - w / 2; M[1, 2] += center[1] - h / 2
    warped = cv2.warpAffine(card, M, (S, S), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)
    mask = cv2.warpAffine(np.full((h, w), 255, np.uint8), M, (S, S), flags=cv2.INTER_NEAREST)
    m = mask > 0
    canvas[m] = warped[m]; owner[m] = cid
    return M

def index_polys(M, idx, w=500, h=700):
    x0, y0, x1, y1 = idx
    tl = np.array([[x0 * w, y0 * h], [x1 * w, y0 * h], [x1 * w, y1 * h], [x0 * w, y1 * h]])
    br = np.array([[w - x, h - y] for x, y in tl])
    out = []
    for poly in (tl, br):
        pts = np.hstack([poly, np.ones((4, 1))]) @ M.T
        out.append(pts)
    return out

def scene(cards, idx, rng):
    canvas = background(rng); owner = np.full((S, S), -1, np.int32)
    names = list(cards)
    placed = []   # (cid, name, M)
    r = rng.random()
    if r < 0.65:   # ribbon spread
        n = rng.randint(8, len(names))
        order = rng.sample(names, n)
        ch = rng.uniform(90, 300)                   # card height in px
        cw = ch * 5 / 7
        sp = cw * rng.uniform(0.07, 0.25)           # spacing between cards
        L = sp * (n - 1)
        turn = 0 if rng.random() < 0.45 else rng.uniform(-math.pi, math.pi) * rng.uniform(0.2, 1)
        heading = rng.uniform(0, 2 * math.pi)
        # start so the spread is roughly centred
        pts, hd = [], []
        x, y, a = 0.0, 0.0, heading
        for i in range(n):
            pts.append((x, y)); hd.append(a)
            a += turn / max(1, n - 1); x += sp * math.cos(a); y += sp * math.sin(a)
        P = np.array(pts); P -= P.mean(0); P += [S / 2 + rng.uniform(-80, 80), S / 2 + rng.uniform(-80, 80)]
        flip = 180 if rng.random() < 0.5 else 0      # which corner trails: top-left or bottom-right
        for i, name in enumerate(order):
            ang = -math.degrees(hd[i]) + flip + rng.uniform(-2, 2)
            # card's width runs along the path
            M = place(canvas, owner, cards[name], i, (P[i][0], P[i][1]), ang, ch)
            placed.append((i, name, M))
    else:          # loose cards / one close-up card (bottom-card view)
        k = 1 if rng.random() < 0.5 else rng.randint(2, 6)
        for i, name in enumerate(rng.sample(names, k)):
            ch = rng.uniform(250, 620) if k == 1 else rng.uniform(120, 320)
            c = (rng.uniform(80, S - 80), rng.uniform(80, S - 80)) if k > 1 else (S / 2 + rng.uniform(-120, 120), S / 2 + rng.uniform(-120, 120))
            M = place(canvas, owner, cards[name], i, c, rng.uniform(0, 360), ch)
            placed.append((i, name, M))
    labels = []
    for cid, name, M in placed:
        for poly in index_polys(M, idx):
            x0, y0 = poly.min(0); x1, y1 = poly.max(0)
            if x1 <= 0 or y1 <= 0 or x0 >= S or y0 >= S: continue
            m = np.zeros((S, S), np.uint8); cv2.fillPoly(m, [poly.astype(np.int32)], 1)
            area = m.sum()
            if area < 30: continue
            vis = (m.astype(bool) & (owner == cid)).sum() / area
            if vis < 0.7: continue
            xa, ya, xb, yb = max(0, x0), max(0, y0), min(S, x1), min(S, y1)
            if (xb - xa) * (yb - ya) < 0.6 * (x1 - x0) * (y1 - y0): continue   # mostly off-frame
            labels.append((NAMES.index(name), (xa + xb) / 2 / S, (ya + yb) / 2 / S, (xb - xa) / S, (yb - ya) / S))
    return photo_effects(canvas, rng), labels

def photo_effects(img, rng):
    f = img.astype(np.float32)
    # lighting: brightness, contrast, colour temperature, soft shadow
    f = (f - 128) * rng.uniform(0.7, 1.25) + 128 + rng.uniform(-40, 30)
    f *= np.array([rng.uniform(0.85, 1.1), 1, rng.uniform(0.85, 1.15)], np.float32)
    if rng.random() < 0.5:
        g = np.linspace(rng.uniform(0.55, 1), 1, S); g = g[:, None] if rng.random() < 0.5 else g[None, :]
        f *= g[..., None]
    if rng.random() < 0.3:   # glare blob
        cx, cy, rad = rng.uniform(0, S), rng.uniform(0, S), rng.uniform(60, 220)
        yy, xx = np.mgrid[0:S, 0:S]; f += 70 * np.exp(-((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * rad ** 2))[..., None]
    f = np.clip(f, 0, 255).astype(np.uint8)
    if rng.random() < 0.5: f = cv2.GaussianBlur(f, (0, 0), rng.uniform(0.3, 1.6))
    if rng.random() < 0.2:   # motion blur
        k = rng.randint(3, 9); ker = np.zeros((k, k), np.float32); ker[k // 2] = 1 / k
        ker = cv2.warpAffine(ker, cv2.getRotationMatrix2D((k / 2, k / 2), rng.uniform(0, 180), 1), (k, k)); ker /= ker.sum() or 1
        f = cv2.filter2D(f, -1, ker)
    f = np.clip(f.astype(np.float32) + np.random.randn(S, S, 3) * rng.uniform(0, 8), 0, 255).astype(np.uint8)
    q = rng.randint(45, 95)
    return cv2.imdecode(cv2.imencode('.jpg', f, [cv2.IMWRITE_JPEG_QUALITY, q])[1], cv2.IMREAD_COLOR)

if __name__ == '__main__':
    card_dir, out, count = sys.argv[1], sys.argv[2], int(sys.argv[3])
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else 0
    rng = random.Random(seed); np.random.seed(seed)
    cards, idx = load_cards(card_dir)
    os.makedirs(f'{out}/images', exist_ok=True); os.makedirs(f'{out}/labels', exist_ok=True)
    for i in range(count):
        img, labels = scene(cards, idx, rng)
        name = f'{seed:03d}_{i:05d}'
        cv2.imwrite(f'{out}/images/{name}.jpg', img)
        with open(f'{out}/labels/{name}.txt', 'w') as fh:
            for c, x, y, w, h in labels: fh.write(f'{c} {x:.6f} {y:.6f} {w:.6f} {h:.6f}\n')
    print('wrote', count, 'scenes to', out)
