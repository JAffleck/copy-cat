# Extension Specification: "Copy Cat" Content Script Refactor

## 1. Overview
"Copy Cat" is a text-extraction browser extension activated via a hotkey combination (`Ctrl + Shift + Left-Click`). 
Once activated, it enters a structured visual target selection mode that abstracts DOM element nodes into text payloads, rendering persistent visual overlay boxes around targeted elements and displaying a text compilation preview toast in an isolated Shadow DOM container wrapper.

The extension must not modify the host page DOM.

All UI must be rendered inside a Shadow DOM attached to a single injected root element.

Selection tracking must use DOM reads only
(getBoundingClientRect, elementFromPoint, TreeWalker, etc.)
and must not mutate page elements.

For all elements used, a shadow DOM should be employed.
When extension is activated, no text-selection (i.e. with click and drag or double clicking) should be allowed.  This creates confusion for text elements selected.

The plugin should be available for all sites and will use the clipboard and localstorage to store a view variable settings.

#### Definitions
Selection Mode:
  SINGLE_SNIP - This means only a single highlight target can be selected and it's text copied.
  MULTI_SNIP - This means multiple highlight targets can be selected.  Only one is active at a time, and right-clicking will freeze it, and add a new one at mouse pointer location.

Output Format: This affects the processing of text for preview and for copying to clipboard
  Combined - Concatenate all child element, or text targets together separating each with a space
  Split    - Each child element or text node is SPLIT into a separate line in the copy preview.

Line Style:
  Raw - This is the raw element with no changes other than normalizing the text to remove comments or hidden characters that aren't displayed, 
		this should change the outputs of text content to behave similar to the innerText javascript API.
  Quoted - RAW but adds quote marks around the entire text selection (in COMBINED), or around every line of text (in SPLIT).
  CSV - Append tralining commas to every line of text except the final one
  Quoted_comma - Combination of QUOTED and CSV, quotes each line, then appends a comma (comma not appended to final line)
  Numbered - Adds a number `1.` before each line of output text.
  Bulleted - Adds a number `*` before each line of output text.

Zooming actions - Any of the following actions perform zooming:
  ArrowUp = zoom in
  ArrowDown = zoom out
  WheelUp = zoom in
  WheelDown = zoom out
  Pinch-in = zoom out
  Pinch-out = zoom in


The extension supports two operational Pointer Tracking Styles configured via `chrome.storage.local` under the key `trackingMode`:
1. `multi-select = false` (Default): Dynamic, mouse-driven pointer tracking.
2. `multi-select = true`: Right-click driven accumulation tracking to freeze and aggregate multiple separate text fragments.

Separately, the extension tracks Line Format output mode via hotkeys during selection mode:
1. `single-line`: Cleans up line breaks, tabs, and runs of white space into a uniform single line layout.
2. `multi-line`: Preserves structured vertical block divisions and line breaks.

---

## 2. Definitive Operational Rules

### Rule A: Mode Activation & Initialization
- Trigger: `Ctrl + Shift + Left-Click` on any webpage coordinates.
- Action: 
  - Read the tracking configuration state (`trackingMode`: `'multi-select'`) from storage.
  - Set `isSelectionMode = true`.
  - Instantly resolve the DOM element directly beneath the click coordinates and evaluate it as the active target block.
  - Intercept, prevent default behavior, and kill propagation of the initial triggering click so it does not interact with underlying webpage components (e.g., following links or focusing input blocks).

### Rule B: Cursor Hover Tracking Mechanics
- In `single-select` mode:
  - The active target block continuously tracks and snaps to whatever semantic element is directly underneath the user's cursor as it moves.
- In `multi-select` mode:
  - Right-clicking an element or textnode freezes the currently active selection into a frozen segment cache, and immediately evaluates and snaps a new active selection block directly onto the underlying element under that right-click coordinate placement.

### Rule C: Mouse Interaction Patterns

#### 1. Right-Click Event Behavior (`button === 2`)
- In `single-select` mode: Right-click is completely ignored or blocked.
- In `multi-select` mode: 
  - Action: A single right-click pushes the current active selection element into a `frozenRanges` array cache as a permanently frozen segment. 
  - Immediate Snap: Instantly re-calculates coordinates and targets the new underlying element directly under that right-click placement as the next active selection block, releasing the previous cursor focus so the user can seamlessly select the next element without a secondary locking step.

#### 2. Left-Click Event Behavior (`button === 0`)
- Action: Compiles the entire accumulated text payload from all frozen brackets and the active selection block according to the active formatting sub-mode, writes it cleanly to the system clipboard, displays a "Text Copied!" banner notification inside the Shadow DOM UI view, and cleanly triggers a complete teardown/exit of selection mode.
- Note: Clicking anywhere during selection mode must copy and finish—it must never pass through and interact with the page or break state.

### 3.X Multi-Line Inline Element Highlight Handling
To prevent "block masking" (where inline elements spanning multiple lines generate a massive unified box overlay covering empty space), the overlay engine must distinguish between structural block containers and inline text streams.

- Geometric Mapping Protocol:
    - For structural block-level elements (`DIV`, `P`, `LI`, `H1-H6`, `TABLE`), the overlay box may calculate coordinates using a single `getBoundingClientRect()` envelope.
    - For inline elements (`A`, `SPAN`, `EM`, `STRONG`, `B`, `I`), raw text nodes, and character-level subnodes, the engine MUST NOT use a single bounding rect. Instead, it must invoke `getClientRects()` to retrieve the array of individual line coordinates.
- Visual Overlay Generation:
    - The engine must loop through the returned `DOMRectList` from `getClientRects()` and render a distinct, tightly bound overlay box overlay fragment for `each individual line fragment` generated by the text wrap.
    - All visual fragments belonging to the active target must share identical styling states (opacity, border colors, and backgrounds) and transitions, updating simultaneously as a cohesive group.

### Rule D: Keyboard, Navigation & Gesture Controls

If selection mode not active, 
`Ctrl+Shift+Left-Click` used to activate selection mode must never be treated as a copy confirmation click.
Cancel Active selection means Instantly drops all state, wipes visual overlays, and exits selection mode without saving or modifying the clipboard. Displays a "Cancelled Copy!" banner.
if selection mode active
`Ctrl+Shift+Left-Click - cancels Cancel Active selection
- `Escape` Key: cancels Cancel Active selection
- `⌫ Key`: Same cancels Cancel Active selection
- `Shift + Space` toggle between `SINGLE_SNIP` and `MULTI_SNIP`
- `Tab` Key: Cycle forward through available `LINE_STYLE` values.
  - When `Output Format = COMBINED`, the only valid `LINE_STYLE` is `QUOTED`.
  - `RAW`, `QUOTED_COMMA`, `NUMBERED`, and `BULLETED` are not available in `COMBINED` mode.
- `Shift + Tab` Key: Cycle backward through available `Styles` values.
  - When switching into `COMBINED`, reset `LINE_STYLE` to `RAW`.
  - When switching back into `SPLIT`, the previously selected multiline `LINE_STYLE` should be restored.
- `q` Key for certain modes, cycle throgh `LINE_STYLE_SETTINGS`
		If `SPLIT + QUOTED` or `SPLIT + QUOTED_COMMA` constraint mode is active, cycle through active enclosing quote characters (`"`, `'`, `` ` ``). Any matching quote characters inside the selected text must be escaped with a preceding backslash (`\`).
		If `SPLIT + NUMBERED` is set, cycle through number styles `1.`, `i.`, `a.`, `A.`
		if `SPLIT + BULLETED` is set, cycle through bullet styles `-`, `*`, `•`
- Change text zoom scope (`ArrowUp` / `ArrowDown` / Mouse Wheel / Pinch Gestures`):
  - Zoom In: `ArrowUp`, `WheelUp`, `Pinch-Out`
  - Zoom Out: `ArrowDown`, `WheelDown`, `Pinch-In`
  - Updates element scoping natively by walking upward to parent containers or downward into child elements, text nodes and text subnodes.


### Line Decoration Settings
- raw text - This just leaves the text as is returning the normalized text from the element or text node in the selection block
- Surroumd with quotes - This just leaves the text as is

### Extension Button Popup Display

When clicking the extension icon, the popup should display the current active output mode using the following legend:

🔴 - COMBINED + QUOTED
🔵 - SPLIT + RAW
🟦 - SPLIT + QUOTED
🟩 - SPLIT + QUOTED_COMMA
📊 - SPLIT + CSV
#️⃣ - SPLIT + NUMBERED
⏺️ - SPLIT + BULLETED

This should also show a key listing the hotkeys:

Ctrl + Shift + Click - Start/Stop active highlighting
Esc/⌫/⌫/ - Cancel copying
Left-click - Copy selection
Right-click - (Multi-Snip), Freeze and Add Selection

Tab - Cycle through Styles
Shift + Tab - Cycle through Styles
Q -        Cycle through Style Options styles
Shift + Q: Cycle Style Options styles (reverse) 
(note: in single line - Style is quoted)

SHIFT + SPACE: Toggle 'Single Snip' / 'Multi-Snip'
SPACE: Toggle Element zoom / nested bookend zoom

Selection Zooming:
⬆️ / ⬇️ - Zoom in/out
Mousewheel Up/down - Zoom in/out
Pinch Zoom In/Out - Zoom in/out

#### Zooming (Hierarchical Scope Selection)
##### Zoomed element styling
Zooming behavior depends on the Selection mode:
With the initial selection there is an overlay that follows the mouse everywhere. It doesn't use a bounding rectangle, 
but adds a opacity of 30% based on the color of the unicode icon from the popup unicode icon displayed for the boundaries of the active tartget element/node.
This also has a SOLID top, left, right and bottom border, of the same color (border has 100% opacity) 

##### Element and textnode Zooming rules
Hierarchical Scope Selection (HSS): The selection scope is driven by number of characters in text content, 
prioritized by the increase or decrease of selected text length for preview or clipboard copying.
- Zoom In (Narrow Scope): 
The selection narrows to the largest descendant element or text node containing a smaller text string than the current scope. 
If multiple descendants exist, select the descendant with the largest text length, 
progressively drilling down until an individual text node or a leaf element is reached.
- Zoom Out (Expand Scope): 
The selection moves to the smallest ancestor element that results in a larger text compared to current scope. 
The system bypasses skips containers or parent elements that don't increase the selected text size. 
This continues until reaching the document.body or the largest available text container.

Initialization: Upon activation (Ctrl + Shift + Left-Click), 
the initial scope is the smallest atomic text node or leaf element directly under the mouse pointer.

Boundary: Zooming in continues until the selection reaches an individual text node or a leaf element (an element with no further children).

##### Text Subnode Zooming rules
After zooming in to an single text node, zooming further continues to a single text subnode consistenting of:
- Bookended text item (items enclosed by a start and end mark): 
	parenthesis, 
	brackets, 
	curly braces, 
	quotation mark pairs (not single apostraphes)
	
	e.g. for this html snippet:
	<div>
	 textnode with "double", 'single quote', `back quoted`, (123), [a list, of strings], {"squirrely braces"}
    </div>
	
	from above parent text node starting with:
	  textnode with "double" ...
	based on mouse pointer potential text subnodes are:
		"double"
		'single'
		`back quoted`
		(123)
		[a list, of strings]
		{"squirrely braces"}
	Note: each of the above items can be zoomed past its bookend start and end characters
		"double" → double
		{"squirrely braces"} → "squirrely braces" 
		etc.
		which can then be zoomed in further to 
		"squirrely braces" → squirrely braces
		And these can be zoomed out to return to the previous selection
		squirrely braces → "squirrely braces" → {"squirrely braces"}
		double → "double"
		etc.
	As in the case of {"squirrely braces"} multiple nested text subnodes can exist in a textnode, and each should be able to be zoomed in/out.
	The nested subnodes can be any of the bookend types, or even the same type
	(e.g. different types with {"squirrely braces"})
	Same type if there as a text subnode like
		(a, (b,c))
		
	Note on single quotes:
		- if a word ends in a contraction in English, i.e. (ends in apostraphe-s like James's dog), don't coun't the apostraphe as a single quote marker 
		Do the same for other contractions ending in:
		'll,'d,'ve,'re,'m,'t,'nt,'ve
		- if there's an unmatched bookend character i.e. any in this group, ignore them for zoom selection so that zooming in zooms to a word from the text node, or next logical zoom in step, same for zooming out 
		",',`,[,],(,),{,}
		
- Single word
this includes any characters with accented characters (not just latin-based characters), as well as words in kebab-case-style, or snake_case_style.
- Note words in kebab-case-style, or snake_case_style can be zoomed further to the word section under the cursor:
  e.g.
  kebab-case-style 
  could be zoomed to any of the following:
  kebab
  case
  style
Zooming back out should reselect previous item selected
  e.g.  kebab → kebab-case-style 
(so when zooming in, store current selection before zooming in further, so if zooming back out, zoomed item can be restored).

Initialization: Upon activation, 
Zoom is set to this priority of HTML tag type:
'A', 'SPAN', 'I', 'B', 'U', 'STRONG', 'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'LABEL', 'P', 'LI', 'TD', 'TH', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
or the smallest possible element or text node found directly under the mouse pointer.

### Single-Snip Selection Mechanics
In single-snip, at the mouse pointer location, the smallest element with text is the initial selected scope.  
Whereever the mouse is moved to, that change scope to that targeted element or sibling text node
If mouse is moved from an inline element to a neighboring text node, select the text node: 
E.g. if hovering over `link`, and mouse is moved to `pre-node`, select `pre-node`, or if moved from text node back to `link`, reselect the `link`, then moved to `post-node`,  reselect that, and if a span is selected then reselect that.
	<div>
	 pre-node
	 </a>link</a>
	 post-node
	 <span>I'm a span</span>
    </div>


Zooming in will zoom in on a element or text nodes inside of the selected element.
Zooming out will zoom to the next element, or text node encompassing the current selection.


#### Special cases for element zooming (SELECT, INPUT and TEXTAREA elements)
- SELECT
Ancestors of SELECT element, or highlighting a SELECT element should initially get text of current selected option.  
Zooming in on a SELECT should display all of the text of all of its descendants (but shouldn't zoom to individual elements or text groups).

- INPUT
INPUT[type=text/date/number/url/email]), if "value" is empty, return "placeHolder" property value 

- TEXTAREA
same for TEXTAREA elements and content editable divs

### Multi-Snip Selection Mechanics
`MULTI_SNIP` behaves the same as single-snip selection, until a right-click is done to freeze the selection.
After right-clicking, this freezes the current selection, then creates a new active selection wherever the user moves the mouse too.
To make it clear what text is selected, if a selection was highlighted, then mouse is moved over a frozen item, cancel active selection 
(i.e. make it blank for current selection until mouse is moved to a valid element/text node.  
If textnode adjacent to a frozen selection is highlighted, select that)

Zooming out also blocks enclosing any previous text selections/elements, if attempting to zoom out to a level that encompasses a frozen selection, 
zoom is blocked and selection remains at largest valid zoom before attempt.
If zoomed out and the user zooms in over a valid child element/node/subnode, that valid target under the mouse pointer becomes the active target.
Zooming in isn't blocked (since whatever is currently selected will be valid with no frozen descendant elements/textnodes/subnodes).

#### Multi-Snip mode Frozen element styling and behavior
When right-click is pressed the current element is frozen and added to the end of an array of frozen text selections.
A frozen selection:

- Receives a DASHED border.
- Retains fixed boundaries.
- Does not change expand/narrow when zooming in or out.
- Is appended to the frozen selection list in selection order.

Zoom-out operations stop at the nearest valid ancestor that does not contain a frozen selection.
Zooming in remains allowed.
No overlapping frozen selections are allowed.
If right-clicking when active selection is empty is ignored.
If right-click is pressed on a valid non-emty selection, freeze the active selection.


### Preview display
On the first line displays the key from the Popup display.
On the rest shows the normalized textcontent of the element/node(s) selected.  The preview will display items in the order of selection.
The preview displays selections in selection order:

1. Frozen selections in the order they were added.
2. The current active selection.
3. On the final line of the preview show 
  [Space] switch to {otherSnipMode} 
  i.e. if `otherSnipMode` is Single-Snip show
  [Space] switch to Multi-Snip
  and vice versa
  [Space] switch to Single-Snip
  
#3 above should be displayed in yellow text in italics
Compilation order always follows this same sequence.

Only visible text should be included.

Hidden content includes:

- `display: none`
- `visibility: hidden`
- `opacity: 0`
- Content positioned permanently outside the scrollable viewport (for example `position:absolute; left:-9999px`)

The preview window looks about like a toast in the bottom-right area of the screen
Preview content should behave similarly to the browser's `innerText` extraction behavior while respecting the extension's formatting options.

### Toast message
Toast messages should display in the bottom-right area of the screen, and when displayed, should hide the text displayed in preview.
The toast should just be a little bit wider than the text it covers
Toast messages to display:
- when left-clicking:
😸 Text Copied! 😸
- When cancelling a selection (by pressing `esc`, `delete`, `backspace` or `CTRL + SHIFT + CLICK` with an active selection):
❌ Copy Cancelled ❌


### Ending selection
While active, either of the following will end selection:
left-clicking will copy selected text
pressing a cancel hotkey - (e.g. Escape, Backspace or Delete key, or CTRL + SHIFT + CLICK)
`isSelectionMode` will then be set to false

### Tracking Mode Storage

The following settings must be persisted using `chrome.storage.local`:

- `trackingMode` (`SINGLE_SNIP` or `MULTI_SNIP`)
- `outputFormat` (`COMBINED` or `SPLIT`)
- `lineDecoration`
- `quoteCharacter`




TODO
#Line Decoration section is obsolete

You still have:

raw text - ...
Surroumd with quotes - ...

This section no longer reflects your actual decoration system:

RAW
QUOTED
QUOTED_COMMA
NUMBERED
BULLETED

Rewrite or remove it.


# Extension Specification: "Copy Cat" Content Script Refactor

## 1. Overview
"Copy Cat" is a text-extraction browser extension activated via `Ctrl + Shift + Left-Click`. It enters a structured visual target selection mode that abstracts DOM element nodes into text payloads, rendering persistent visual overlay boxes and displaying a text compilation preview in a Shadow DOM toast container.

- Host Isolation: Must not modify host DOM; all UI rendered in a Shadow DOM.
- State Persistence: Settings (`trackingMode`, `outputFormat`, `lineDecoration`, `quoteCharacter`, `bulletStyle`, `outlineStyle`) are persisted via `chrome.storage.local`.
- Activation: `Ctrl + Shift + Left-Click` initiates mode and prevents default propagation.

## 2. Definitive Operational Rules

### Rule A: Selection Mechanics & Hierarchical Zoom
- Initialization: Upon activation, the initial scope is the smallest atomic text node or leaf element containing text directly under the mouse pointer.
- Hierarchical Scope Selection (HSS):
    - Zoom Out (Expand Scope): Moves to the smallest parent container encompassing an incrementally larger set of text. Bypasses empty containers. Continues until `document.body` or maximum container is reached.
    - Zoom In (Narrow Scope): Narrows to the largest descendant element or text node containing a smaller subset of text than the current scope. Drills down until an individual text node or leaf element is reached.
- Multi-Mode Constraints: In `MULTI_SNIP`, zoom-out is restricted by existing frozen selections.




### Rule B: Interaction Patterns, and Hotkeys
- Ctrl + Shift + Click - Activate highlighting
- Esc - Cancel copying
- ⌫ - Cancel copying
- Left-click - Copy text
- Right-click - (`MULTI_SNIP`), Add new text selection target
Tab - Cycle through the LINE_STYLE
	(note: in single line - only LINE_STYLE is quoted)
- Left-Click: Compiles text, copies to clipboard, shows "Text Copied!" toast, and exits mode.
- Right-Click (`MULTI_SNIP` only): Freezes current selection, appends to `frozenRanges`, and snaps to new target.
- Escape / Backspace / Delete: Wipes state, shows "Cancelled Copy!" toast, and exits mode.
- Tab: Cycles through `LINE_STYLE` modes (`RAW`, `QUOTED`, `QUOTED_COMMA`, `NUMBERED`, `BULLETED`).
- Shift + Tab: Toggle `OutputFormat` (`COMBINED` / `SPLIT`).
- q: Cycles Line Decoration style options. Cache the last used style for each category in `chrome.storage.local`:
Hotkey Cycling: Pressing q will increment the styleIndex and wrap around to 0 when the end of the array is reached, ensuring the cycle is intuitive.
- Shift + Q: Cycles Line Decoration style options in reverse order 
    QUOTED:   `"`, `'`, `` ` ``
    BULLETED: `•`, `-`, `*`
    OUTLINE:  `1.`, `i.`, `A.`, `a.`
Zooming hotkeys:
- Zoom Out: ArrowUp, WheelUp, Pinch-Out
- Zoom In: ArrowDown, WheelDown, Pinch-In

### Rule C: Output Formatting
- COMBINED: Concatenates targets with single space.
- SPLIT: Targets on separate lines.
- Line Decoration Prefixes:
    - RAW: Normalized text.
    - QUOTED: Adds quotes per `quoteCharacter`.
    - QUOTED_COMMA: Adds quotes and trailing comma (except last line).
    - NUMBERED: Prefixes with `outlineStyle` sequence.
    - BULLETED: Prefixes with `bulletStyle` symbol.

### Rule D: Preview & Compilation
- Compilation Order: Follows selection order.
- Visibility: Only includes visible text (excludes display: none, visibility: hidden, opacity: 0, and off-screen elements).



##### Code to requirements variation:
1. Hierarchical Scope Selection (HSS) vs. Naive DOM Walking
The Requirement: Zooming should be driven by text volume and density. Zooming out must find the nearest ancestor that actually increases the text payload (skipping empty wrappers). Zooming in must target the child node with the highest density of text.

The Code: The code completely ignores text metrics. Zooming out blindly selects parentElement, while zooming in uses a basic elementFromPoint COMBINED with a hardcoded TAG_PRIORITY array.

2. Multi-Select Zoom-Out Safeguard
The Requirement: In MULTI_SNIP mode, the user must be blocked from zooming out to an ancestor element that encompasses any currently frozen selections.

The Code: There is no collision validation during a zoom-out event. A user can zoom out and accidentally swallow up previously frozen elements.

3. Dynamic UI Coloring Based on Active Mode
The Requirement: The overlay boundaries should have a 30% opacity fill and a 100% solid border matching the explicit color scheme/meaning of the active unicode status icon (e.g., Red for Single-Line, Blue for Multi-Line Raw, etc.).

The Code: The overlay colors are hardcoded to standard Blue (active) and Green (frozen) via CSS classes, completely disconnected from the active mode icons.


If you want the extension to automatically reject highlighting elements or parents that have zero physical alphanumeric text payload, update the text constraint check in your zoom logic.


#### Limitations:
This doesn't work in iframes. That's due to both browser and chrome extension security and CORS limitations imposed by Google.

##TO TEST:
  Select elements should initially get text of current selected option.  Zooming in further should get the text of all of the options.
  Test page, more examples, Volvo line Zooming out has issues.
  Zooming out goes really slow 
  https://www.w3schools.com/tags/tag_select.asp

  text input(e.g. type=text/date/number/url/email, if empty, get value of placeHolder property
  same for textarea elements or content editable divs
  https://www.html-code-generator.com/drop-down/state-names

#### Future improvements

- Change toast message, so that the width is more narrow with the text message

- Be able to zoom in more granularly from smallest element/textnode to:
  Single word, zoom-in/zoom-out past:
	(items SPLIT by comma, e.g. be able to zoom in on just 'given names' or lastname (and remove the comma out, and trim the surrounding text of whitespace)
	<div>
	 lastname, given names
    </div>
	Changes to either of the following basedd on cursor position:
	 lastname
	 given names
	
	parenthesis, 
	brackets, 
	curly braces, 
	quote marks (not single apostraphes, but pairs of quotes)

- Select 
	https://www.html-code-generator.com/drop-down/state-names
	or
	test.html
- Snake-case kebab case, quotes:
	https://en.wikipedia.org/wiki/Snake_case
	
- Ctrl + Shift + Right-Click
	- 🔗 link mode
		- L = switch between link modes 
			- getLinkText vs getLinkTargetUrl, vs hyperlink
				maybe if scoped to a link element or something with an href, or a button that does a get(like an href),
				Color the link in a different color, and allow user to toggle between, linkText, url, and an actual copied Link (i.e. copy text hyperlinked to URL, to the clipboard)


Changes made:
Run by AI:
Changed wording:
- Snipping mode - single, vs multi-snip
- Changed wording from SINGLE_LINE to COMBINED
- Changed wording from MULTI_LINE to SPLIT
- Change functionality of multi-snip mode and right-clicking and zoom mechanics
	right click freezes current selection, but other than that it behaves almost the exact same as single-snip mode.
	### Frozen element styling and behavior
	##### Single-Snip Selection Mechanics
	### Zooming to sub-textnodes (i.e. subnodes)
	### Multi-Snip Selection Mechanics
- added terminology for subnodes (textnode descendants - 'Enclosed' text (quotes/parens/brackets/etc), or words) 
	- TODO make sure I'm ont overloading the term 'Enclosed' in doc
	- TODO make sure I'm ont overloading the term 'Enclosed' in doc
	- TODO make sure I'm ont overloading the term 'Enclosed' in doc