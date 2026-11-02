# Pocket Prediction

A tool for a card trick by Liam Levanon (mentalist). Test build; the end goal is a fast, reliable iPhone app.

## The effect
Spectator shuffles. Liam "writes a prediction" in the real Notes app. Spectator cuts any number of
times and pockets the top card unseen. The prediction names the pocketed card.

## Method (what the app does)
1. **Scan:** deck spread face up; the back camera sweeps along it and learns the order.
2. **Face-down wait:** phone placed face down, back camera up. It ignores everything until it has seen
   darkness (no cards) for ~0.6 s, so the spread can't be mistaken for the bottom card.
3. **Bottom card:** Liam passes the deck over the phone; the camera reads the bottom card
   (two reads in a row must agree).
4. **Deduce:** cuts only rotate the cycle, so pocket card = card after the bottom card in the scanned order
   (`pocketCard` in `logic.js`). Works with incomplete decks: only the cycle actually scanned is used.
5. **Output (test build):** shows the pocket card on screen. Later: hand it to an iOS Shortcut that
   writes it into a note in Notes.

## Files
- `index.html`: the whole app (UI, camera, model runtime, sweep scanner, face-down mode, photo fallback).
- `logic.js`: pure logic, shared with the tests: card names, `pocketCard`, `orderFromDetections`
  (still photo, orders along the spread's own axis, handles two rows of corners), `SweepScanner`
  (stitches live frames).
- `md0.wasm` + `md1.wasm`: the card-reader model (YOLOv8s, 52 classes, fp16 ONNX, dynamic input),
  split into two files (hosting limits). Concatenated in `loadEngine()`.
- `rt0.wasm` + `rt1.wasm`, `ort.min.mjs`, `ort-wasm-simd-threaded.jsep.mjs`: onnxruntime-web 1.31.1
  (WebGPU when available, else WASM). The runtime wasm is split the same way and passed as `wasmBinary`.
- `coi-serviceworker.min.js`: enables cross-origin isolation on GitHub Pages so the CPU path can use threads.
- `tests/`: `node tests/logic.test.js`, `node tests/sweep.test.js` (simulated sweeps),
  `tests/browser-live.playwright.js` (full live flow with a fake camera video, see file).
- `training/`: synthetic-spread generator and evaluation for training a reader on Liam's own deck.

## Hosting
GitHub Pages from `main` / root: https://liamlev.github.io/Pocket-prediction/ (Liam switches Pages on in
repo settings). The live camera does NOT work inside claude.ai artifact pages (camera blocked), only on its own site.

## Speed decisions (Liam: "as fast as possible")
- The model reads cards best when they are SMALL in its input, which is also fastest:
  sweep alternates 480/384 px, bottom card alternates 224/288 px. Close-ups at 640 fail.
- Input is the frame's aspect rounded to 32 px (no square padding); buffers reused; every size is
  warmed up at load so the first real read has no setup delay.
- WebGPU first, WASM fallback. Reads run back to back on `requestVideoFrameCallback`; no stale queue.
- Everything runs on the phone; internet is only used to load the page.
- The settings area shows the engine and ms per read. Ask Liam for those numbers from his iPhone.
- Future: a native iOS app with Core ML would be faster still.

## Sweep scanner rules (logic.js `SweepScanner`)
- Each frame's cards are projected onto the spread's axis, then mapped into a shared coordinate with a
  robust fit (median of pairwise slopes) against cards already placed.
- A card's position = median of its largest group of agreeing sightings; it's confirmed after 3.
- Unconfirmed sighting on top of a confirmed card → misread, dropped after 8 reads. In open space →
  blocks completion (might be a real end/gap card) until seen again.
- Gap = spacing > 1.7× median → "card missing between X and Y".
- Both ends must be seen with open table beyond them (≥2 votes) unless all 52 are in.
- "Cards in this deck": an exact count (default 52, remembered per phone) finishes the moment that
  many are confirmed; "not sure" modes need a minimum plus both ends. Liam's current Bicycle test deck
  has 47 cards (no 2♣ 2♥ 2♠ 3♣ A♦).
- UI: full-screen camera with guide corners and a scan line; 52-card grid (grey unseen, amber checking,
  green confirmed); the done message shows the first and last card so Liam can glance at both ends
  (the only undetectable failure is an end card never read at all).
- Counting is in reads, not seconds, so slow and fast phones behave the same.

## Accuracy
Current reader (Nov 2026): fine-tuned on tiles cut from Liam's real Bicycle spread photos s2+s3
(hand labels) + synthetic + public data. Held-out real photo s1 (47-card deck): 40/47 read, 0 wrong
(previous reader: 39/47, 1 wrong). Training data/scripts lived in the session workspace (real/labels.py,
make_real_tiles.py); more real photos is the best way to improve further.

### Background: the original problem
The off-the-shelf reader (`training/models/yolov8s_playing_cards.pt`) found ~40/52 on Liam's real
spread with misreads: it was trained on mostly visible cards, not tight spreads where only thin,
often upside-down corners show (6/9 confusion). On 98 real labelled photos it scored ~70%.
Plan, agreed with Liam: train on HIS deck. He always uses **Bicycle** cards.
- Liam supplies: 4 photos of the 52 cards (one suit each, laid flat, not overlapping, dark surface,
  shot from above), plus 2–3 test spreads in new-deck order (one straight, one curved), full resolution.
- Crop/rectify each card to 500×700 → `CODE.png` (e.g. `AS.png`, `10H.png`) + `index.json` with the
  corner-index box as fractions (`{"index": [x0, y0, x1, y1]}`, measure it on the Bicycle cards).
- `python training/gen_spreads.py CARD_DIR OUT_DIR COUNT SEED` makes labelled scenes: ribbon spreads
  (straight/curved, either direction, tight/loose), loose cards, single close-ups, varied backgrounds
  and lighting. `standin_cards.py` makes fake cards to test the pipeline.
- Fine-tune from the existing model (class order matches `NAMES` in index.html), e.g.
  `yolo detect train model=training/models/yolov8s_playing_cards.pt data=ds.yaml imgsz=480 freeze=10 mosaic=0 fliplr=0`.
  `fliplr=0` matters: mirrored indices aren't real cards. On a 2-core CPU this ran ~0.5 s/image;
  a GPU (or a Mac with `device=mps`) is far faster.
- Export: `YOLO(...).export(format='onnx', dynamic=True, simplify=True, opset=17)`, then fp16 via
  `onnxruntime.transformers.float16.convert_float_to_float16(m, keep_io_types=True, op_block_list=['Resize'])`
  after clearing `m.graph.value_info` (the onnxconverter-common version breaks on Resize). Split into
  `md0.wasm`/`md1.wasm` (<20 MB each) and update the byte sizes in `loadEngine()`.
- Judge it ONLY on Liam's real test spreads: report how many of 52 were read and in the right order.

## Other notes
- Spread direction setting: default left→right = top→bottom of the face-down deck (deck flipped face up, then spread).
- Liam prefers quick, practical updates; he's often working from his phone.
