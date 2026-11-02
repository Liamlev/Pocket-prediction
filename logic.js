// Pure trick logic — no camera, no model. Shared by the page and the tests.
(function (root) {
  const RANKS = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', '10': 'Ten', '9': 'Nine', '8': 'Eight',
    '7': 'Seven', '6': 'Six', '5': 'Five', '4': 'Four', '3': 'Three', '2': 'Two' };
  const SUITS = { C: 'Clubs', D: 'Diamonds', H: 'Hearts', S: 'Spades' };
  const SYMBOL = { C: '♣', D: '♦', H: '♥', S: '♠' };

  const cardName = c => `${RANKS[c.slice(0, -1)]} of ${SUITS[c.slice(-1)]}`;
  const cardShort = c => c.slice(0, -1) + SYMBOL[c.slice(-1)];
  const isRed = c => /[DH]$/.test(c);
  const median = a => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

  // One still photo: keep each card's most confident sighting, order left to right.
  function orderFromDetections(detections) {
    const best = new Map();
    for (const d of detections) { const cur = best.get(d.cls); if (!cur || d.conf > cur.conf) best.set(d.cls, d); }
    // Order along the spread's own line (any angle), not across the picture, so a diagonal or
    // upright spread reads correctly. Start from the end nearer the picture's left (or top).
    const pts = [...best.values()].map(d => ({ ...d, y: d.y ?? 0 }));
    if (pts.length < 3) return pts.sort((a, b) => a.x - b.x).map(d => d.cls);
    const mx = pts.reduce((s, d) => s + d.x, 0) / pts.length, my = pts.reduce((s, d) => s + d.y, 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const d of pts) { const dx = d.x - mx, dy = d.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    let v = [Math.cos(th), Math.sin(th)];
    // A spread often shows two rows of corners (top and bottom of each card). Those rows tilt the
    // first estimate; refine it using the direction of each row on its own.
    for (let iter = 0; iter < 3; iter++) {
      const perp = d => -(d.x - mx) * v[1] + (d.y - my) * v[0];
      const ps = pts.map(perp).sort((a, b) => a - b);
      let gi = 0, gap = 0; for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] > gap) { gap = ps[i] - ps[i - 1]; gi = i; }
      const rows = gap > 0 && gi >= 2 && ps.length - gi >= 2 ? [pts.filter(d => perp(d) < ps[gi]), pts.filter(d => perp(d) >= ps[gi])] : [pts];
      let cxx = 0, cxy = 0, cyy = 0;
      for (const r of rows) {
        const rx = r.reduce((s, d) => s + d.x, 0) / r.length, ry = r.reduce((s, d) => s + d.y, 0) / r.length;
        for (const d of r) { const dx = d.x - rx, dy = d.y - ry; cxx += dx * dx; cxy += dx * dy; cyy += dy * dy; }
      }
      const t2 = 0.5 * Math.atan2(2 * cxy, cxx - cyy); const nv = [Math.cos(t2), Math.sin(t2)];
      v = nv[0] * v[0] + nv[1] * v[1] < 0 ? [-nv[0], -nv[1]] : nv;
    }
    if (Math.abs(v[0]) > 0.3 ? v[0] < 0 : v[1] < 0) v = [-v[0], -v[1]];
    return pts.map(d => ({ c: d.cls, t: d.x * v[0] + d.y * v[1] })).sort((a, b) => a.t - b.t).map(o => o.c);
  }

  // Cuts only rotate the cycle. reversed=false: left-to-right in the spread == top-to-bottom
  // of the face-down deck, so the pocketed (former top) card is the one AFTER the bottom card.
  function pocketCard(order, bottom, reversed = false) {
    const i = order.indexOf(bottom), n = order.length;
    if (i < 0 || n < 2) return null;
    return order[(i + (reversed ? -1 : 1) + n) % n];
  }

  /* Sweep scanner: the phone moves along the spread, so each frame sees part of it at a
     different offset and zoom. Each frame's cards are projected onto the spread's axis, then
     mapped into one shared coordinate (global = a*local + b) using cards already placed.
     A card's position is the median of all its placements, so one misread cannot move it. */
  class SweepScanner {
    constructor(opts = {}) {
      this.minSeen = opts.minSeen ?? 3;         // sightings before a card counts as confirmed
      this.settleMs = opts.settleMs ?? 1500;    // no new cards for this long → stable
      this.gapFactor = opts.gapFactor ?? 1.7;   // spacing this much over the median → a card is probably missing
      this.reset();
    }
    reset() {
      this.obs = new Map();   // card -> [global positions]
      this.conf = new Map();  // card -> best confidence
      this.firstAt = new Map(); // card -> frame number when first seen
      this.lastNewFrame = 0;
      this.ends = { lo: new Map(), hi: new Map() }; // card -> times seen with open table beyond it
      this.lastNewAt = 0; this.frames = 0; this.lostFrames = 0; this.axis = null; this.spacing = null;
    }
    // A card's position is the median of its largest group of agreeing sightings, so a misread
    // elsewhere neither moves it nor counts towards confirming it.
    cluster(c) {
      const o = this.obs.get(c), tol = 0.5 * (this.spacing || Infinity);
      let best = o;
      if (o.length > 1 && isFinite(tol)) {
        let bestN = 0;
        for (const x of o) { const near = o.filter(y => Math.abs(y - x) <= tol); if (near.length > bestN) { bestN = near.length; best = near; } }
      }
      return best;
    }
    pos(c) { return median(this.cluster(c)); }
    support(c) { return this.cluster(c).length; }

    // dets: [{cls, x, y, conf}] for one frame. now: ms timestamp.
    // frame: {x0, y0, x1, y1} picture bounds (lets us see when we are past the end of the spread).
    addFrame(dets, now, frame = null) {
      const byCard = new Map();
      for (const d of dets) { const c = byCard.get(d.cls); if (!c || d.conf > c.conf) byCard.set(d.cls, d); }
      let cards = [...byCard.values()];
      // Drop sightings well off the line of the spread (something else on the table).
      if (cards.length >= 4 && this.axis) {
        const ax0 = this.axis, perp = d => -d.x * ax0[1] + d.y * ax0[0];
        const mp = median(cards.map(perp)), mh = median(cards.map(d => d.h || 0));
        if (mh > 0) cards = cards.filter(d => Math.abs(perp(d) - mp) <= 5 * mh);
      }
      if (cards.length < 2) return 'few';
      this.frames++;
      // Spread axis: principal direction of the card centres, sign kept consistent across frames.
      let ax = this.axis;
      if (cards.length >= 4 || !ax) {
        const mx = cards.reduce((s, d) => s + d.x, 0) / cards.length, my = cards.reduce((s, d) => s + d.y, 0) / cards.length;
        let sxx = 0, sxy = 0, syy = 0;
        for (const d of cards) { const dx = d.x - mx, dy = d.y - my; sxx += dx * dx; sxy += dx * dy; syy += dy * dy; }
        const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
        let v = [Math.cos(th), Math.sin(th)];
        const ref = this.axis || [1, 0];
        if (v[0] * ref[0] + v[1] * ref[1] < 0) v = [-v[0], -v[1]];
        this.axis = ax = v;
      }
      const local = cards.map(d => ({ cls: d.cls, conf: d.conf, t: d.x * ax[0] + d.y * ax[1] }));
      let a = 1, b = 0;
      const shared = local.filter(l => this.obs.has(l.cls));
      if (this.obs.size === 0) { /* first frame defines the coordinate */ }
      else if (shared.length >= 2) {
        // Robust fit: median of pairwise slopes, then median intercept.
        const slopes = [];
        for (let i = 0; i < shared.length; i++) for (let j = i + 1; j < shared.length; j++) {
          const dl = shared[j].t - shared[i].t; if (Math.abs(dl) < 1e-6) continue;
          slopes.push((this.pos(shared[j].cls) - this.pos(shared[i].cls)) / dl);
        }
        if (!slopes.length) { this.lostFrames++; return 'lost'; }
        a = median(slopes);
        if (!(a > 0)) { this.lostFrames++; return 'lost'; } // order flipped against what we have: ignore frame
        b = median(shared.map(s => this.pos(s.cls) - a * s.t));
      } else { this.lostFrames++; return 'lost'; }   // can't place this view: moved too fast
      let added = false;
      for (const l of local) {
        const g = a * l.t + b;
        if (!this.obs.has(l.cls)) { this.obs.set(l.cls, []); this.firstAt.set(l.cls, this.frames); added = true; }
        const o = this.obs.get(l.cls); o.push(g); if (o.length > 25) o.shift();
        this.conf.set(l.cls, Math.max(this.conf.get(l.cls) || 0, l.conf));
      }
      // Card spacing in shared units, from this frame (used to judge agreement and gaps).
      if (local.length >= 3) {
        const g = local.map(l => a * l.t + b).sort((x, y) => x - y);
        const sp = median(g.slice(1).map((v, i) => v - g[i]));
        if (sp > 0) this.spacing = this.spacing ? 0.8 * this.spacing + 0.2 * sp : sp;
      }
      // Ends of the spread: if, along the spread's line, the picture shows open table beyond the
      // outermost card (more than 1.5 card spacings), that card is an end. Needs several votes.
      if (frame && local.length >= 3) {
        const mx = cards.reduce((s, d) => s + d.x, 0) / cards.length, my = cards.reduce((s, d) => s + d.y, 0) / cards.length;
        let lo = -Infinity, hi = Infinity;
        for (const [p, v, a0, a1] of [[mx, ax[0], frame.x0, frame.x1], [my, ax[1], frame.y0, frame.y1]]) {
          if (Math.abs(v) < 1e-9) continue;
          const s1 = (a0 - p) / v, s2 = (a1 - p) / v;
          lo = Math.max(lo, Math.min(s1, s2)); hi = Math.min(hi, Math.max(s1, s2));
        }
        const c0 = mx * ax[0] + my * ax[1], tLo = c0 + lo, tHi = c0 + hi;
        const sorted = [...local].sort((x, y) => x.t - y.t);
        const lsp = median(sorted.slice(1).map((v, i) => v.t - sorted[i].t));
        const first = sorted[0], last = sorted[sorted.length - 1];
        if (lsp > 0 && first.t - tLo > 1.5 * lsp) this.ends.lo.set(first.cls, (this.ends.lo.get(first.cls) || 0) + 1);
        if (lsp > 0 && tHi - last.t > 1.5 * lsp) this.ends.hi.set(last.cls, (this.ends.hi.get(last.cls) || 0) + 1);
      }
      if (added) { this.lastNewAt = now; this.lastNewFrame = this.frames; }
      return added ? 'new' : 'ok';
    }

    // Snapshot for the meter.
    // minCards: fewest cards that can count as a whole spread (52 = full deck: done the moment all 52 are in).
    // exact: the deck has exactly minCards cards, so finish the moment all of them are confirmed.
    state(now, minCards = 2, exact = false) {
      // Not yet confirmed (seen < minSeen times). It is dropped as a misread only if it sat on top of
      // a confirmed card. One seen in open space might be a real card at an end or in a gap, so it
      // keeps the scan from finishing until it is seen again (or a long time has passed).
      const keys = [...this.obs.keys()];
      const confirmed = keys.filter(c => this.support(c) >= this.minSeen);
      const order = confirmed.map(c => ({ c, p: this.pos(c) })).sort((x, y) => x.p - y.p);
      const tol = 0.5 * (this.spacing || 0);
      const pendingCards = keys.filter(c => this.support(c) < this.minSeen).filter(c => {
        const age = this.frames - this.firstAt.get(c), p = this.pos(c);
        const onTopOfCard = order.some(o => Math.abs(o.p - p) < tol);
        return onTopOfCard ? age < 8 : age < 150;
      }).map(c => ({ c, p: this.pos(c) }));
      const all = [...confirmed, ...pendingCards.map(x => x.c)];
      const gaps = [];
      if (order.length >= 4) {
        const diffs = order.slice(1).map((o, i) => o.p - order[i].p);
        const m = median(diffs);
        diffs.forEach((d, i) => { if (d > this.gapFactor * m) gaps.push({ after: order[i].c, before: order[i + 1].c, missing: Math.round(d / m) - 1 }); });
      }
      const pending = all.length - confirmed.length;
      const settled = now - this.lastNewAt >= this.settleMs && this.frames - this.lastNewFrame >= 6;
      const enough = order.length >= Math.max(2, minCards);
      // Both ends must have been seen with open table past them (not needed once all 52 are in).
      const full = exact ? order.length >= minCards : order.length === 52;
      const loEnd = order.length ? (this.ends.lo.get(order[0].c) || 0) >= 2 : false;
      const hiEnd = order.length ? (this.ends.hi.get(order[order.length - 1].c) || 0) >= 2 : false;
      const endsOk = full || (loEnd && hiEnd);
      const complete = enough && pending === 0 && gaps.length === 0 && endsOk && (settled || full);
      // Meter: how close we are to "complete" (time-settling plus every card confirmed, minus gaps).
      const settleFrac = Math.min(1, (now - this.lastNewAt) / this.settleMs);
      const countFrac = Math.min(1, order.length / Math.max(2, minCards));
      const confFrac = all.length ? confirmed.length / all.length : 0;
      const progress = complete ? 1 : Math.min(0.97, minCards > 2
        ? 0.75 * countFrac + 0.15 * confFrac + 0.1 * settleFrac
        : 0.5 * confFrac + 0.5 * settleFrac) * (gaps.length ? 0.6 : 1);
      return { order: order.map(o => o.c), positions: order.map(o => o.p), pending, pendingCards, gaps, complete,
        progress: endsOk || complete ? progress : Math.min(progress, 0.9), enough, loEnd: full || loEnd, hiEnd: full || hiEnd };
    }
  }

  const api = { cardName, cardShort, isRed, orderFromDetections, pocketCard, SweepScanner, median };
  if (typeof module !== 'undefined') module.exports = api; else root.TrickLogic = api;
})(this);
