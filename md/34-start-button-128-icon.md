# Plan 34: Start button uses 128.png

## Request
Use the `128.png` file for the popup's "Start selecting" button.

## Change
- `popup.html`: `#start-selecting` image `src="icon-1024-cropped.png"` → `src="128.png"`.
  Size stays 120×120 with rounded corners (128.png is 128×128, so it's scaled down slightly).
- `tests/headless/e2e14.mjs`: the start-button check also asserts the image is `128.png`.

## Testing
- `tests/headless/e2e14.mjs`; screenshot of the Copier tab.
