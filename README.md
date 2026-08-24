# Minimal Whiteboard

A tiny tldraw / excalidraw-style whiteboard built with plain HTML, CSS and JavaScript - no frameworks, no build step.

**Author: Ansh Kumar Verma**


<img src="https://api.visitorbadge.io/api/VisitorHit?user=anshverma1975&repo=whiteboard&label=VIEWS&countColor=7c3aed&labelColor=1e1b4b" alt="Views" />

## Features

- **Pen** with color palette + custom color picker and adjustable stroke width
- **Eraser** that removes whole strokes/shapes it touches
- **Rectangle** and **Circle** tools (drag to draw)
- **Text** tool with adjustable font size (Shift+Enter for a new line, Enter to commit)
- **Dark mode** toggle (remembers your choice, follows system preference by default)
- **Configurable keybinds** for every tool via the settings dialog (top-right gear icon)
- Undo / Redo (`Ctrl+Z` / `Ctrl+Shift+Z`)
- Infinite canvas: scroll with the mouse wheel, hold **Space** and drag (or middle-mouse drag) to pan
- Everything persists in your browser (theme, colors, sizes, keybinds)

## Run locally

Just open `index.html` in a browser, or serve the folder:

```bash
npx serve .
```

Then visit http://localhost:3000

## Deploy on Vercel

Option A - Dashboard: push this folder to GitHub, then import the repo at vercel.com. It is a static site, so no configuration is needed.

Option B - CLI:

```bash
npm i -g vercel
vercel
```

## Default shortcuts

| Tool      | Key |
|-----------|-----|
| Pen       | P   |
| Eraser    | E   |
| Rectangle | R   |
| Circle    | O   |
| Text      | T   |

Change any of these from the settings dialog. Press `Escape` while capturing to cancel.
