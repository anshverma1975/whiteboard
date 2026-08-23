/* Whiteboard - Ansh Kumar Verma */
(() => {
'use strict';

// ---------- DOM ----------
const wrap = document.getElementById('canvas-wrap');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const editor = document.getElementById('text-editor');
const fontRow = document.getElementById('font-row');
const widthRange = document.getElementById('width-range');
const widthVal = document.getElementById('width-val');
const fontRange = document.getElementById('font-range');
const fontVal = document.getElementById('font-val');
const customColor = document.getElementById('custom-color');
const themeToggle = document.getElementById('theme-toggle');
const settingsOpenBtn = document.getElementById('settings-open');
const settingsBackdrop = document.getElementById('settings-backdrop');
const settingsCloseBtn = document.getElementById('settings-close');
const bindsResetBtn = document.getElementById('binds-reset');
const eraserCursorEl = document.getElementById('eraser-cursor');

// ---------- constants ----------
const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';
const LINE_HEIGHT = 1.25;
const PRESETS = ['ink', '#e03131', '#2f9e44', '#1971c2', '#f08c00'];
const DEFAULT_BINDS = { pen: 'p', eraser: 'e', rect: 'r', circle: 'o', text: 't' };
const LS = {
  theme: 'wb.theme',
  binds: 'wb.binds',
  color: 'wb.color',
  width: 'wb.width',
  font: 'wb.font'
};

// ---------- helpers ----------
function store(key, value) { try { localStorage.setItem(key, value); } catch (err) {} }
function read(key) { try { return localStorage.getItem(key); } catch (err) { return null; } }
function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

// ---------- camera / infinite canvas ----------
// Elements are stored in world coordinates; the camera is the world offset
// shown at the top-left corner of the viewport.
const camera = { x: 0, y: 0, z: 1 };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
function toWorld(p) { return { x: p.x / camera.z + camera.x, y: p.y / camera.z + camera.y }; }
function applyCamera() {
  updateZoomUI();
  if (editing) syncEditorPosition();
  scheduleRedraw();
}
function setZoom(nz, focus) {
  const z2 = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nz));
  if (!focus) focus = { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 };
  const wx = focus.x / camera.z + camera.x;
  const wy = focus.y / camera.z + camera.y;
  camera.z = z2;
  camera.x = wx - focus.x / z2;
  camera.y = wy - focus.y / z2;
  applyCamera();
}
function resetZoom() { setZoom(1); }
function updateZoomUI() {
  const lbl = document.getElementById('zoom-reset');
  if (lbl) lbl.textContent = Math.round(camera.z * 100) + '%';
}
function panBy(dx, dy) {
  camera.x += dx / camera.z;
  camera.y += dy / camera.z;
  applyCamera();
}

// ---------- state ----------
let elements = [];
let draft = null;
let drawing = false;
let tool = 'pen';
let color = read(LS.color) || '#1971c2';
let strokeWidth = clampInt(read(LS.width), 1, 24, 3);
let fontSize = clampInt(read(LS.font), 12, 72, 20);
const history = [];
const redoStack = [];
let editing = false;
let erasePrev = null;
let panning = null;
let spaceDown = false;
let rafId = null;

const binds = (() => {
  const raw = read(LS.binds);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const merged = {};
      Object.keys(DEFAULT_BINDS).forEach((t) => { merged[t] = parsed[t] || DEFAULT_BINDS[t]; });
      return merged;
    } catch (err) {}
  }
  return Object.assign({}, DEFAULT_BINDS);
})();

// ---------- theme ----------
function initTheme() {
  let t = read(LS.theme);
  if (t !== 'light' && t !== 'dark') {
    t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = t;
}

themeToggle.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store(LS.theme, next);
  scheduleRedraw();
  themeToggle.blur();
});

// ---------- colors ----------
function inkColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#000000';
}
function resolveColor(c) { return c === 'ink' ? inkColor() : c; }

function setColor(c) {
  color = c;
  store(LS.color, c);
  updateSwatches();
}

function updateSwatches() {
  document.querySelectorAll('.swatch[data-swatch]').forEach((s) => {
    s.classList.toggle('active', s.dataset.swatch === color);
  });
  customColor.classList.toggle('active', !PRESETS.includes(color));
}

// ---------- canvas sizing ----------
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, wrap.clientWidth);
  const h = Math.max(1, wrap.clientHeight);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  scheduleRedraw();
}

// ---------- rendering ----------
function scheduleRedraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = null; redraw(); });
}

function redraw() {
  ctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
  ctx.save();
  // scale first, then translate => screen = (world - camera) * zoom
  // this matches toWorld(): world = screen / zoom + camera
  ctx.scale(camera.z, camera.z);
  ctx.translate(-camera.x, -camera.y);
  for (const el of elements) drawElement(el);
  if (draft) drawElement(draft);
  ctx.restore();
}

function drawElement(el) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = el.width;
  ctx.strokeStyle = resolveColor(el.color);
  if (el.type === 'pen') drawPen(el);
  else if (el.type === 'rect') drawRect(el);
  else if (el.type === 'circle') drawCircle(el);
  else if (el.type === 'text') drawText(el);
}

function drawPen(el) {
  const pts = el.points;
  if (!pts.length) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length < 3) {
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  } else {
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function rectBox(el) {
  return {
    x: Math.min(el.x1, el.x2),
    y: Math.min(el.y1, el.y2),
    w: Math.abs(el.x2 - el.x1),
    h: Math.abs(el.y2 - el.y1)
  };
}

function drawRect(el) {
  const b = rectBox(el);
  ctx.beginPath();
  ctx.rect(b.x, b.y, b.w, b.h);
  ctx.stroke();
}

function drawCircle(el) {
  const cx = (el.x1 + el.x2) / 2;
  const cy = (el.y1 + el.y2) / 2;
  const rx = Math.max(Math.abs(el.x2 - el.x1) / 2, 0.5);
  const ry = Math.max(Math.abs(el.y2 - el.y1) / 2, 0.5);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function drawText(el) {
  const lines = String(el.text).split('\n');
  ctx.font = el.fontSize + 'px ' + FONT;
  ctx.textBaseline = 'top';
  ctx.fillStyle = resolveColor(el.color);
  lines.forEach((line, i) => {
    ctx.fillText(line, el.x, el.y + i * el.fontSize * LINE_HEIGHT);
  });
}

function textMetrics(text, size) {
  ctx.save();
  ctx.font = size + 'px ' + FONT;
  const lines = String(text).split('\n');
  let w = 0;
  for (const line of lines) w = Math.max(w, ctx.measureText(line).width);
  ctx.restore();
  return { w: w, h: lines.length * size * LINE_HEIGHT };
}

// ---------- hit testing (eraser) ----------
function distToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function hitElement(el, p) {
  const T = Math.max(8, (el.width || 2) / 2 + 4);
  if (el.type === 'pen') {
    const pts = el.points;
    if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y) <= T;
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegment(p, pts[i], pts[i + 1]) <= T) return true;
    }
    return false;
  }
  if (el.type === 'rect') {
    const b = rectBox(el);
    const nearX = p.x >= b.x - T && p.x <= b.x + b.w + T;
    const nearY = p.y >= b.y - T && p.y <= b.y + b.h + T;
    return (
      (nearY && Math.abs(p.x - b.x) <= T) ||
      (nearY && Math.abs(p.x - (b.x + b.w)) <= T) ||
      (nearX && Math.abs(p.y - b.y) <= T) ||
      (nearX && Math.abs(p.y - (b.y + b.h)) <= T)
    );
  }
  if (el.type === 'circle') {
    const cx = (el.x1 + el.x2) / 2;
    const cy = (el.y1 + el.y2) / 2;
    const rx = Math.abs(el.x2 - el.x1) / 2;
    const ry = Math.abs(el.y2 - el.y1) / 2;
    const dOut = Math.hypot((p.x - cx) / (rx + T || T), (p.y - cy) / (ry + T || T));
    const inRx = rx - T;
    const inRy = ry - T;
    const dIn = inRx > 0 && inRy > 0
      ? Math.hypot((p.x - cx) / inRx, (p.y - cy) / inRy)
      : Infinity;
    return dOut <= 1 && dIn >= 1;
  }
  if (el.type === 'text') {
    const m = textMetrics(el.text, el.fontSize);
    return (
      p.x >= el.x - 4 && p.y >= el.y - 4 &&
      p.x <= el.x + m.w + 4 && p.y <= el.y + m.h + 4
    );
  }
  return false;
}

// ---------- history ----------
function beginChange() {
  history.push(JSON.stringify(elements));
  if (history.length > 100) history.shift();
  redoStack.length = 0;
}

function undo() {
  if (!history.length || drawing || editing) return;
  redoStack.push(JSON.stringify(elements));
  elements = JSON.parse(history.pop());
  draft = null;
  scheduleRedraw();
}

function redo() {
  if (!redoStack.length || drawing || editing) return;
  history.push(JSON.stringify(elements));
  elements = JSON.parse(redoStack.pop());
  draft = null;
  scheduleRedraw();
}

// ---------- erasing ----------
function eraseSegment(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 4));
  for (let i = 1; i <= steps; i++) {
    const q = { x: a.x + (dx * i) / steps, y: a.y + (dy * i) / steps };
    for (let j = elements.length - 1; j >= 0; j--) {
      if (hitElement(elements[j], q)) elements.splice(j, 1);
    }
  }
}

// ---------- pointer input ----------
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault(); // stop default focus-steal so the text editor keeps focus
  const sp = pos(e);

  // middle mouse or space+drag => pan the infinite canvas
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    if (editing) commitText();
    panning = { sx: sp.x, sy: sp.y, cx: camera.x, cy: camera.y };
    document.body.classList.add('panning');
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
    return;
  }

  if (e.button !== 0) return;
  if (editing) commitText();
  const p = toWorld(sp);
  if (tool === 'text') { openEditor(p); return; }

  drawing = true;
  beginChange();
  erasePrev = p;
  if (tool === 'pen') {
    draft = { type: 'pen', points: [p], color: color, width: strokeWidth };
  } else {
    draft = { type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: color, width: strokeWidth };
  }
  try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
});
canvas.addEventListener('pointermove', (e) => {
  const sp = pos(e);
  updateEraserCursor(sp);

  if (panning) {
    camera.x = panning.cx + (panning.sx - sp.x);
    camera.y = panning.cy + (panning.sy - sp.y);
    applyCamera();
    return;
  }

  if (!drawing) return;
  const p = toWorld(sp);

  if (tool === 'pen') {
    draft.points.push(p);
  } else if (tool === 'eraser') {
    eraseSegment(erasePrev, p);
    erasePrev = p;
  } else if (draft) {
    draft.x2 = p.x;
    draft.y2 = p.y;
  }
  scheduleRedraw();
});

// wheel => pan the infinite canvas (excalidraw-style scrolling)
canvas.addEventListener('wheel', (e) => {
  e.preventDefault(); // also blocks browser page-zoom on ctrl+wheel
  if (e.ctrlKey || e.metaKey) {
    // zoom with ctrl + wheel, similar to excalidraw
    const delta = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom(camera.z * delta, { x: wrap.clientWidth / 2, y: wrap.clientHeight / 2 });
  } else {
    // pan without ctrl
    const scale = e.deltaMode === 1 ? 16 : 1; // line-based deltas (Firefox)
    panBy(e.deltaX * scale, e.deltaY * scale);
  }
}, { passive: false });

function releasePointer(e) {
  if (e && e.pointerId !== undefined) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  }
}

function finishStroke(e) {
  if (panning) {
    panning = null;
    document.body.classList.remove('panning');
    if (e && e.pointerId !== undefined) {
      try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    return;
  }
  if (!drawing) return;
  drawing = false;
  if (e && e.pointerId !== undefined) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  }
  if (draft) {
    if (draft.type === 'pen' && draft.points.length === 1) {
      const s = draft.points[0];
      draft.points.push({ x: s.x + 0.01, y: s.y });
    }
    elements.push(draft);
    draft = null;
    scheduleRedraw();
  }
}

canvas.addEventListener('pointerup', finishStroke);
canvas.addEventListener('pointercancel', (e) => {
  panning = null;
  document.body.classList.remove('panning');
  drawing = false;
  draft = null;
  releasePointer(e);
  scheduleRedraw();
});

// ---------- eraser ring cursor (excalidraw-style) ----------
const ERASER_SIZE = 20;

function updateEraserCursor(sp) {
  if (tool !== 'eraser' || panning || spaceDown) {
    eraserCursorEl.style.display = 'none';
    return;
  }
  eraserCursorEl.style.display = 'block';
  eraserCursorEl.style.width = ERASER_SIZE + 'px';
  eraserCursorEl.style.height = ERASER_SIZE + 'px';
  eraserCursorEl.style.left = Math.round(sp.x - ERASER_SIZE / 2) + 'px';
  eraserCursorEl.style.top = Math.round(sp.y - ERASER_SIZE / 2) + 'px';
}

canvas.addEventListener('pointerleave', () => {
  eraserCursorEl.style.display = 'none';
});

// ---------- text editor ----------
// The editor is a DOM element living in screen pixels, so every world
// coordinate must go through the same (world - camera) * zoom mapping
// as the canvas transform.
function syncEditorPosition() {
  const wx = parseFloat(editor.dataset.x) || 0;
  const wy = parseFloat(editor.dataset.y) || 0;
  editor.style.fontSize = Math.round(fontSize * camera.z) + 'px';
  editor.style.left = Math.round((wx - camera.x) * camera.z) + 'px';
  editor.style.top = Math.round((wy - camera.y) * camera.z) + 'px';
}

function openEditor(p) { // p is in world coordinates
  editing = true;
  editor.style.display = 'block';
  editor.style.color = resolveColor(color);
  editor.dataset.x = String(p.x);
  editor.dataset.y = String(p.y);
  editor.value = '';
  syncEditorPosition();
  resizeEditor();
  editor.focus();
}

function resizeEditor() {
  const fs = Math.round(fontSize * camera.z);
  const left = ((parseFloat(editor.dataset.x) || 0) - camera.x) * camera.z;
  const m = textMetrics(editor.value || ' ', fs);
  const maxW = Math.max(40, wrap.clientWidth - left - 8);
  editor.style.width = Math.min(Math.max(m.w + 8, 48), maxW) + 'px';
  editor.style.height = (Math.ceil(m.h) + 6) + 'px';
}

function hideEditor() {
  editor.style.display = 'none';
  editor.blur();
}

function commitText() {
  if (!editing) return;
  editing = false;
  const x = parseFloat(editor.dataset.x);
  const y = parseFloat(editor.dataset.y);
  const value = editor.value.replace(/\s+$/, '');
  hideEditor();
  if (!value.trim()) return;
  beginChange();
  elements.push({ type: 'text', x: x, y: y, text: value, color: color, fontSize: fontSize });
  scheduleRedraw();
}

function cancelText() {
  editing = false;
  hideEditor();
}

editor.addEventListener('input', resizeEditor);
editor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitText();
  } else if (e.key === 'Escape') {
    cancelText();
  }
});
editor.addEventListener('blur', () => commitText());

// ---------- tools ----------
const toolButtons = document.querySelectorAll('#toolbar [data-tool]');

function setTool(t) {
  if (!(t in DEFAULT_BINDS)) return;
  if (editing) commitText();
  tool = t;
  document.body.dataset.tool = t;
  toolButtons.forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  fontRow.hidden = t !== 'text';
  eraserCursorEl.style.display = 'none';
}

toolButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    setTool(btn.dataset.tool);
    btn.blur();
  });
});

// ---------- properties ----------
document.querySelectorAll('.swatch[data-swatch]').forEach((s) => {
  s.addEventListener('click', () => {
    setColor(s.dataset.swatch);
    s.blur();
  });
});
customColor.addEventListener('input', () => setColor(customColor.value));

widthRange.addEventListener('input', () => {
  strokeWidth = parseInt(widthRange.value, 10) || 3;
  widthVal.textContent = String(strokeWidth);
  store(LS.width, String(strokeWidth));
});

fontRange.addEventListener('input', () => {
  fontSize = parseInt(fontRange.value, 10) || 20;
  fontVal.textContent = String(fontSize);
  store(LS.font, String(fontSize));
});

// ---------- settings modal + keybinds ----------
function openSettings() { settingsBackdrop.hidden = false; }
function closeSettings() { settingsBackdrop.hidden = true; }

settingsOpenBtn.addEventListener('click', () => {
  openSettings();
  settingsOpenBtn.blur();
});
settingsCloseBtn.addEventListener('click', closeSettings);
settingsBackdrop.addEventListener('click', (e) => {
  if (e.target === settingsBackdrop) closeSettings();
});

const keyButtons = document.querySelectorAll('.keybtn[data-tool]');

function refreshBindsUI() {
  keyButtons.forEach((b) => {
    b.textContent = binds[b.dataset.tool].toUpperCase();
  });
}

function saveBinds() { store(LS.binds, JSON.stringify(binds)); }

function flashConflict(btn) {
  btn.classList.add('conflict');
  setTimeout(() => btn.classList.remove('conflict'), 500);
}

keyButtons.forEach((btn) => {
  btn.addEventListener('focus', () => {
    btn.textContent = '...';
    btn.classList.add('capturing');
  });
  btn.addEventListener('blur', () => {
    btn.classList.remove('capturing');
    refreshBindsUI();
  });
  btn.addEventListener('keydown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { btn.blur(); return; }
    if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Enter'].includes(e.key)) return;
    if (e.key.length !== 1 || e.key === ' ') { flashConflict(btn); return; }
    const k = e.key.toLowerCase();
    const owner = Object.keys(binds).find((t) => binds[t] === k && t !== btn.dataset.tool);
    if (owner) { flashConflict(btn); return; }
    binds[btn.dataset.tool] = k;
    saveBinds();
    refreshBindsUI();
    btn.blur();
  });
});

bindsResetBtn.addEventListener('click', () => {
  Object.keys(DEFAULT_BINDS).forEach((t) => { binds[t] = DEFAULT_BINDS[t]; });
  saveBinds();
  refreshBindsUI();
});

document.getElementById('zoom-in').addEventListener('click', () => setZoom(camera.z * 1.25));
document.getElementById('zoom-out').addEventListener('click', () => setZoom(camera.z / 1.25));
document.getElementById('zoom-reset').addEventListener('click', resetZoom);

// ---------- global keyboard ----------
window.addEventListener('keydown', (e) => {
  const target = e.target;
  if (target && target.closest && target.closest('input, textarea')) return;

  if (!settingsBackdrop.hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closeSettings(); }
    return;
  }

  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (mod && !e.altKey && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (!mod && !e.altKey) {
    const t = Object.keys(binds).find((name) => binds[name] === k);
    if (t) { e.preventDefault(); setTool(t); return; }
    if (e.key === 'Escape') cancelText();
  }

  // hold Space to pan the infinite canvas by dragging
  if (e.code === 'Space' && !e.repeat) {
    // don't hijack space when a control is focused (buttons activate on space)
    const el = e.target;
    if (!(el && el.closest && el.closest('input, textarea, select, button'))) {
      spaceDown = true;
      document.body.classList.add('space-pan');
      e.preventDefault();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceDown = false;
    document.body.classList.remove('space-pan');
  }
});

// clear stuck state if focus leaves the window while holding space
window.addEventListener('blur', () => {
  spaceDown = false;
  document.body.classList.remove('space-pan');
});

// ---------- init ----------
initTheme();
widthRange.value = String(strokeWidth);
widthVal.textContent = String(strokeWidth);
fontRange.value = String(fontSize);
fontVal.textContent = String(fontSize);
updateSwatches();
refreshBindsUI();
setTool('pen');
updateZoomUI();
resize();
new ResizeObserver(resize).observe(wrap);
})();
