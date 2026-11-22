# Plan: fix the cat icon's right-eye pupil, real transparency, correct icon sizes (IMPLEMENTED 2026-11-21, not yet committed)

## Current state (checked 2026-11-21, after commit `cc12d9c`)
- `16.png`, `32.png`, `48.png`, `128.png` all exist, all 1024x1024, all fully opaque
  (alpha is 255 everywhere). Originals are safe in commit `cc12d9c`.
- `16`, `32`, `48`: the same head-only cat (tiny pixel differences). The gray/white checkerboard
  is **painted into the pixels**, not real transparency.
- `128`: a **different picture**: a full scene of the cat on a photocopier, with a room
  background and a Gemini sparkle watermark in the bottom-right corner.
- `manifest.json` lists only 16 and 48.
- Pillow 13.0.0 installed with `pip3 install --user --break-system-packages pillow` (done).

## Decisions so far
- Pupil: "left"/"right" as you look at the image. Copy the left eye's pupil into the right
  eye at the **same position inside the right iris as the left pupil sits inside the left
  iris** (option b: both eyes look the same direction). Clear the old right pupil.
- Background: make it **truly transparent** (no checkerboard pixels around the head).

## Steps
1. **Master:** start from `48.png` (head-only), save the edited full-size result as
   `icon-1024.png` (source for all sizes and future edits).
2. **Pupil (on the master):**
   - Find each eye's iris (green region) and pupil (dark disc + white highlight) by color.
   - Measure the left pupil's offset from the left iris center.
   - Clear the right pupil: paint it over with the right iris's green, staying inside the eye
     outline.
   - Paste the left pupil (round mask) into the right iris at the same offset from the right
     iris center, clipped to the right eye so it can't cover the eyelid line.
   - Save a zoomed before/after preview of both eyes (`md/preview-eyes.png`) and check it.
3. **Transparency:** flood-fill from the image edges through the light checkerboard colors,
   stopping at the cat's dark outline; set those pixels to alpha 0 and soften the edge by
   1–2 px so it isn't jagged. Whiskers that stick out past the outline will be kept where they
   differ clearly from the checkerboard; very faint whisker tips may be lost.
4. **Sizes:** downscale the master with Lanczos to `16.png` (16x16), `32.png` (32x32),
   `48.png` (48x48), `128.png` (128x128), overwriting the 1024px files.
5. **Manifest:** `icons` → 16, 32, 48, 128; `action.default_icon` → 16, 32, 48.

## `128.png`: keep the photocopier scene, remove the watermark (decided)
The step 4 `128.png` output comes from the scene instead of the head master:
1. Save the full-size scene with the watermark removed as `icon-scene-1024.png` (master).
2. **Sparkle (around x 935–1000, y 935–1000):** find its pixels by color (lighter and pinker than
   the floor) in that corner, to the right of the copier outline. Paint them over with the
   floor's brown, copying real floor texture from a nearby clean patch so it isn't a flat blob.
3. **Copier outline:** the sparkle's left point covers part of the copier's black outline just
   above the rounded bottom-right corner (around x 944–952, y 955–972). Rebuild it by copying the
   straight vertical stretch of the same outline from just above, so the line runs unbroken
   into the rounded corner.
4. Save a zoomed before/after of that corner (`md/preview-watermark.png`) and check it.
5. Downscale to 128x128 with Lanczos → `128.png`. The scene keeps its background (no
   transparency) and its cat's eyes are left as they are.

## Files
- New: `icon-1024.png`, `icon-scene-1024.png`, `md/preview-eyes.png`, `md/preview-watermark.png`
- Overwritten: `16.png`, `32.png`, `48.png` (from the head master), `128.png` (from the scene)
- Edited: `manifest.json`

## Outcome
- Originals backed up full-size (1024x1024, byte-identical) in `md/originals/`
  (`16.png`, `32.png`, `48.png`, `128.png`); also in commit `cc12d9c`.
- Edited full-size masters: `icon-1024.png` (head: pupil moved, transparent background) and
  `icon-scene-1024.png` (scene: watermark removed by reversing its 50% white overlay).
- Icons regenerated: `16.png`, `32.png`, `48.png` from the head; `128.png` from the scene.
- `manifest.json`: `icons` 16/32/48/128, `action.default_icon` 16/32/48.
- Previews: `md/preview-eyes.png`, `md/preview-watermark.png`.
- Pupil fill note: the old pupil area is filled from the right eye's own iris (inward blend +
  smoothing), not copied from the left eye, to avoid shading seams.
- Editing scripts (outside the repo): `~/.cache/copycat-preview/fix_pupil.py`,
  `remove_watermark.py`, `make_transparent.py`.
