/**
 * Self-contained admin web UI (no external assets - works offline, CSP-nonce protected).
 * Passkeys use the browser's native WebAuthn API.
 * NOTE: the page source below must not contain backticks or dollar-brace sequences.
 */

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>MCP-ARR admin</title>
<style nonce="__NONCE__">
/* Sketchbook look: paper, felt-tip ink, terracotta + teal. System hand-writing fonts only (CSP allows no web fonts). */
:root {
  --bg: #e6d6b2; --paper: #f4ead3; --panel: #f9f1de; --text: #3b322a; --muted: #7a6b5b; --border: #3b322a; --line: #d9c9a4;
  --accent: #d06c43; --accent-deep: #8f4425; --accent-text: #fffaf0; --sea: #5f9e96; --sea-pale: #cfe5df; --olive: #a3a372; --gold: #e3a979; --steel: #b9b4aa;
  --ok: #2f7a3a; --ok-bg: #dcefd9; --err: #a32a1c; --err-bg: #f6d9d2; --warn: #7a4d00; --warn-bg: #f6e3b4;
  --input: #fffaf0; --code: #ece0c2; --shadow: rgba(59, 50, 42, .16);
  --hand: "Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Neue", "Comic Sans MS", "Marker Felt", cursive;
  --body: "Segoe Print", "Bradley Hand", "Chalkboard SE", "Comic Neue", "Comic Sans MS", system-ui, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1f1b16; --paper: #29251f; --panel: #322c24; --text: #f1e6cf; --muted: #b5a78f; --border: #8a7c66; --line: #43392d;
    --accent: #e07f55; --accent-deep: #f2a07b; --accent-text: #25150d; --sea: #78bab1; --sea-pale: #2f5752; --olive: #b7b783; --gold: #c98c5e; --steel: #6d685f;
    --ok: #79c47e; --ok-bg: #1f3a24; --err: #ff9a8a; --err-bg: #4a2420; --warn: #f2c063; --warn-bg: #3f3216;
    --input: #241f19; --code: #3a3329; --shadow: rgba(0, 0, 0, .4);
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.55 var(--body); }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-bottom: 3px solid var(--border); background: var(--paper); }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand svg { width: 64px; height: 44px; flex: none; }
header h1 { font: 700 26px/1 var(--hand); letter-spacing: 1px; margin: 0; white-space: nowrap; }
header .sub { color: var(--muted); font-size: 13px; margin-top: 2px; }
.who { display: flex; align-items: center; gap: 10px; font-size: 14px; }
main { max-width: 1100px; margin: 0 auto; padding: 22px 16px 60px; }
nav.tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
nav.tabs button { border-radius: 14px 18px 12px 16px / 16px 12px 18px 14px; }
nav.tabs button.active { background: var(--sea-pale); border-color: var(--sea); box-shadow: 2px 3px 0 var(--sea); transform: translateY(-1px); }
section { margin-bottom: 28px; }
h2 { font: 700 22px/1.2 var(--hand); margin: 0 0 12px; }
h3 { font: 700 16px/1.3 var(--hand); margin: 16px 0 6px; }
.panel { background: var(--panel); border: 2.5px solid var(--border); border-radius: 16px 20px 14px 22px / 20px 14px 22px 16px; box-shadow: 4px 5px 0 var(--shadow); padding: 16px 18px; margin-bottom: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 18px; }
.grid .panel { margin-bottom: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; }
.card-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.card-title svg.icon { width: 52px; height: 44px; flex: none; }
.card-title strong { font: 700 18px/1.2 var(--hand); }
label { display: block; font-size: 13px; color: var(--muted); margin: 8px 0 3px; }
input[type=text], input[type=password], input[type=url], select {
  width: 100%; padding: 8px 10px; border: 2px solid var(--border); border-radius: 9px 12px 8px 11px; background: var(--input); color: var(--text); font: inherit;
}
input:focus-visible, select:focus-visible, button:focus-visible, a.button:focus-visible, summary:focus-visible { outline: 3px dashed var(--sea); outline-offset: 2px; }
input:disabled { opacity: .65; }
.row { display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
button, a.button { font: inherit; font-size: 14px; padding: 6px 14px; border-radius: 10px 13px 9px 12px; border: 2px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; text-decoration: none; display: inline-block; box-shadow: 2px 3px 0 var(--shadow); }
button:hover:not(:disabled), a.button:hover { background: var(--sea-pale); }
button:active:not(:disabled) { transform: translate(1px, 2px); box-shadow: none; }
button.primary, a.button.primary { background: var(--accent); border-color: var(--accent-deep); color: var(--accent-text); font-weight: 700; }
button.primary:hover:not(:disabled), a.button.primary:hover { background: var(--accent-deep); color: #fffaf0; }
button.danger { color: var(--err); }
button.link { border: none; background: none; color: var(--accent-deep); padding: 0; box-shadow: none; text-decoration: underline; }
button:disabled { opacity: .5; cursor: default; }
.pill { font-size: 12px; padding: 2px 10px; border-radius: 999px; border: 1.5px solid var(--border); background: var(--code); color: var(--muted); white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); border-color: var(--ok); }
.pill.warn { background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }
.pills { display: flex; gap: 6px; flex-wrap: wrap; }
.note { font-size: 12px; color: var(--muted); margin-top: 3px; }
.msg { font-size: 13px; margin-top: 10px; padding: 6px 10px; border-radius: 9px 12px 8px 11px; border: 1.5px solid transparent; display: none; word-break: break-word; }
.msg.ok { display: block; background: var(--ok-bg); color: var(--ok); border-color: var(--ok); }
.msg.err { display: block; background: var(--err-bg); color: var(--err); border-color: var(--err); }
.msg.warn { display: block; background: var(--warn-bg); color: var(--warn); border-color: var(--warn); }
code, pre { font-family: var(--mono); font-size: 13px; }
code { word-break: break-all; }
p, strong, td { overflow-wrap: anywhere; }
pre { background: var(--code); border: 1.5px dashed var(--muted); padding: 10px 12px; border-radius: 9px 12px 8px 11px; overflow-x: auto; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1.5px dashed var(--line); vertical-align: middle; }
th { color: var(--muted); font: 700 14px var(--hand); }
td select { width: auto; padding: 4px 6px; }
details { margin-top: 8px; }
summary { cursor: pointer; font-weight: 700; }
details > div { padding: 6px 0 0 14px; color: var(--muted); font-size: 14px; }
.center { max-width: 440px; margin: 6vh auto; }
.muted { color: var(--muted); }
.hidden { display: none !important; }
.big { width: 100%; padding: 11px; font-size: 16px; }

/* drawings */
svg .ink { stroke: var(--text); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
svg .thin { stroke: var(--text); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; fill: none; }
.f-paper { fill: var(--panel); } .f-clay { fill: var(--accent); } .f-sea { fill: var(--sea); } .f-pale { fill: var(--sea-pale); }
.f-steel { fill: var(--steel); } .f-gold { fill: var(--gold); } .f-ink { fill: var(--text); } .f-none { fill: none; }
.hatch-line { stroke: var(--text); stroke-width: 1.3; opacity: .35; }
.check-ring { fill: var(--paper); stroke: var(--ok); stroke-width: 3; }
.check-tick { fill: none; stroke: var(--ok); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.defs { position: absolute; }
svg .thick { stroke-width: 10; }
.off { opacity: .45; filter: grayscale(.6); }

/* hub sketch on the Services tab */
.hub { padding: 10px; overflow-x: auto; }
.hub svg { display: block; width: 100%; max-width: 760px; margin: 0 auto; height: auto; }
.hub svg.phone { max-width: 440px; }
.hub .arrow-o { stroke: var(--accent-deep); stroke-width: 15; stroke-linecap: round; fill: none; }
.hub .arrow-i { stroke: var(--accent); stroke-width: 9; stroke-linecap: round; fill: none; }
.hub .arrow-h { fill: var(--accent); stroke: var(--accent-deep); stroke-width: 3; stroke-linejoin: round; }
.hub .label { font: 700 18px var(--hand); fill: var(--text); }
.hub .name { font: 15px var(--hand); fill: var(--text); }
.hub .hub-title { font: 700 22px var(--hand); fill: var(--text); }
.hub .tag-box { fill: var(--sea-pale); stroke: var(--sea); stroke-width: 2.5; }
.hub .tag { font: 700 14px var(--hand); fill: var(--text); }
.hub .card-box { fill: var(--paper); stroke: var(--text); stroke-width: 2.5; }
.hub .off-arrow { opacity: .25; }

/* ---- phones and tablets ---- */
body { padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); -webkit-text-size-adjust: 100%; }
@media (pointer: coarse) {
  button, a.button, nav.tabs button { min-height: 44px; padding-top: 9px; padding-bottom: 9px; }
  button.link { min-height: 0; padding: 8px 0; }
  summary { padding: 8px 0; }
  input[type=text], input[type=password], input[type=url], select { min-height: 44px; }
}
@media (max-width: 720px) {
  body { font-size: 16px; }
  /* 16px inputs stop iOS from zooming the page when a field is focused */
  input[type=text], input[type=password], input[type=url], select { font-size: 16px; }
  header { padding: 10px 14px; flex-wrap: wrap; position: sticky; top: 0; z-index: 5; }
  .brand svg { width: 48px; height: 34px; }
  header h1 { font-size: 22px; }
  header .sub { font-size: 12px; }
  .who { font-size: 13px; gap: 8px; margin-left: auto; }
  main { padding: 14px 12px 48px; }
  /* tabs become one swipeable row instead of wrapping over four lines */
  nav.tabs { flex-wrap: nowrap; overflow-x: auto; margin: 0 -12px 16px; padding: 4px 12px 8px; scroll-snap-type: x proximity; scroll-padding-left: 12px; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  nav.tabs::-webkit-scrollbar { display: none; }
  nav.tabs button { flex: none; scroll-snap-align: start; white-space: nowrap; }
  h2 { font-size: 20px; }
  .panel { padding: 14px; box-shadow: 3px 4px 0 var(--shadow); }
  .grid { grid-template-columns: 1fr; gap: 14px; }
  .center { margin: 3vh auto; }
  .row > button, .row > a.button { flex: 1 1 auto; text-align: center; }
  .row code { flex: 1 1 100%; }
  /* the sketch gets its own phone layout instead of scrolling sideways */
  .hub { padding: 6px; overflow-x: visible; }
  /* tables turn into stacked rows: every cell shows its column name */
  .table-wrap { overflow-x: visible; }
  table.stack, table.stack tbody, table.stack tr, table.stack td { display: block; width: 100%; }
  table.stack thead { display: none; }
  table.stack tr { border: 2px solid var(--border); border-radius: 12px 14px 11px 13px; background: var(--paper); padding: 6px 12px; margin-bottom: 12px; }
  table.stack td { display: flex; justify-content: space-between; align-items: center; gap: 14px; padding: 7px 0; border-bottom: 1.5px dashed var(--line); text-align: right; }
  table.stack td:last-child { border-bottom: none; justify-content: flex-end; flex-wrap: wrap; }
  table.stack td::before { content: attr(data-label); flex: none; color: var(--muted); font: 700 13px var(--hand); text-align: left; }
  table.stack td:empty { display: none; }
  table.stack td:last-child::before { content: none; }
  table.stack td select { width: auto; }
  pre { font-size: 12px; }
}
@media (max-width: 380px) {
  .card-head { flex-wrap: wrap; }
  .card-title svg.icon { width: 44px; height: 38px; }
}
</style>
</head>
<body>
<svg class="defs" width="0" height="0" aria-hidden="true" focusable="false">
  <defs>
    <pattern id="hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><line x1="0" y1="0" x2="0" y2="9" class="hatch-line"/></pattern>
    <pattern id="hatchx" width="11" height="11" patternUnits="userSpaceOnUse" patternTransform="rotate(-50)"><line x1="0" y1="0" x2="0" y2="11" class="hatch-line"/></pattern>
  </defs>
</svg>
<header>
  <div class="brand">
    <svg viewBox="-14 0 142 88" aria-hidden="true">
      <path d="M44 14 A32 32 0 1 0 44 74" fill="none" stroke="#d06c43" stroke-width="15" stroke-linecap="round"/>
      <path d="M44 6 A40 40 0 1 0 44 82 M44 22 A24 24 0 1 0 44 66" class="thin" opacity=".7"/>
      <path class="ink f-sea" d="M78 22 C66 18 54 28 56 38 C46 40 46 54 54 58 C48 68 58 78 70 76 C74 84 86 82 88 72 L88 24 Z"/>
      <path class="ink f-sea" d="M92 22 C104 18 116 28 114 38 C124 40 124 54 116 58 C122 68 112 78 100 76 C96 84 86 82 84 72 L84 26 Z"/>
      <path class="thin" d="M66 34 C60 40 70 44 64 50 M104 34 C110 40 100 44 106 50"/>
    </svg>
    <div><h1>MCP-ARR</h1><div class="sub">Media management via AI</div></div>
  </div>
  <div class="who hidden" id="who"><span id="who-name"></span><button id="logout">Sign out</button></div>
</header>
<main id="app"><p class="muted">Loading…</p></main>

<script nonce="__NONCE__">
(function () {
  'use strict';
  var app = document.getElementById('app');
  var who = document.getElementById('who');
  var whoName = document.getElementById('who-name');
  var currentTab = 'services';

  // ---------- DOM helpers ----------
  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k === 'value') e.value = v;
        else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function fmtDate(s) { return s ? new Date(s).toLocaleString() : 'never'; }
  function showMsg(node, kind, text) { node.className = 'msg ' + kind; node.textContent = text; }
  function copyButton(getText) {
    var b = el('button', { type: 'button', text: 'Copy', onclick: function () {
      navigator.clipboard.writeText(getText()).then(function () {
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      });
    } });
    return b;
  }


  // ---------- drawings (hand-drawn service icons, 130x110 box centred on 0,0) ----------
  var ICONS = {
    sonarr: '<path class="thin" d="M-18 -50 L-40 -86 M12 -50 L38 -88"/><rect x="-70" y="-50" width="140" height="100" rx="14" class="ink f-clay"/><rect x="-70" y="-50" width="140" height="100" rx="14" fill="url(#hatch)"/><rect x="-58" y="-38" width="88" height="76" rx="16" class="ink f-steel"/><rect x="-58" y="-38" width="88" height="76" rx="16" fill="url(#hatchx)"/><circle cx="50" cy="-18" r="8" class="ink f-paper"/><circle cx="50" cy="8" r="8" class="ink f-paper"/><path class="thin" d="M-50 50 L-56 66 M50 50 L56 66"/>',
    radarr: '<circle r="58" class="ink f-steel"/><circle r="58" fill="url(#hatch)"/><circle r="12" class="ink f-paper"/><circle cx="0" cy="-34" r="15" class="ink f-ink"/><circle cx="32" cy="-11" r="15" class="ink f-ink"/><circle cx="20" cy="28" r="15" class="ink f-ink"/><circle cx="-20" cy="28" r="15" class="ink f-ink"/><circle cx="-32" cy="-11" r="15" class="ink f-ink"/>',
    lidarr: '<path class="ink f-gold" d="M-34 -56 L50 -74 L50 -48 L-34 -30 Z"/><path class="ink f-gold" d="M-34 -56 L-28 -56 L-28 40 L-34 40 Z M44 -72 L50 -72 L50 24 L44 24 Z"/><ellipse cx="-50" cy="44" rx="24" ry="17" transform="rotate(-20 -50 44)" class="ink f-gold"/><ellipse cx="28" cy="28" rx="24" ry="17" transform="rotate(-20 28 28)" class="ink f-gold"/><ellipse cx="-50" cy="44" rx="24" ry="17" transform="rotate(-20 -50 44)" fill="url(#hatch)"/><ellipse cx="28" cy="28" rx="24" ry="17" transform="rotate(-20 28 28)" fill="url(#hatch)"/>',
    prowlarr: '<rect x="-76" y="-38" width="110" height="36" rx="18" class="ink f-paper"/><path class="thin" d="M-62 -20 L-20 -20"/><path class="ink f-clay" d="M30 26 L44 14 L84 56 Q86 66 76 68 Z"/><circle cx="10" cy="-6" r="40" class="ink thick f-none"/><circle cx="10" cy="-6" r="45" class="thin"/><circle cx="10" cy="-6" r="35" class="thin"/>',
    bazarr: '<path class="ink f-pale" d="M-66 -54 H62 Q74 -54 74 -42 V24 Q74 36 62 36 H-6 L-34 62 L-28 36 H-66 Q-78 36 -78 24 V-42 Q-78 -54 -66 -54 Z"/><rect x="-56" y="-34" width="108" height="16" rx="5" class="ink f-ink"/><rect x="-40" y="-6" width="76" height="16" rx="5" class="ink f-ink"/>',
    tautulli: '<rect x="-64" y="-58" width="128" height="116" rx="10" class="ink f-paper"/><path class="thin" d="M-50 40 H50 M-50 40 V-44"/><rect x="-40" y="4" width="16" height="36" class="ink f-sea"/><rect x="-16" y="-14" width="16" height="54" class="ink f-gold"/><rect x="8" y="-30" width="16" height="70" class="ink f-clay"/><rect x="8" y="-30" width="16" height="70" fill="url(#hatch)"/><path class="ink f-ink" d="M34 -6 L50 4 L34 14 Z"/>',
    overseerr: '<g transform="rotate(-8)"><path class="ink f-gold" d="M-74 -40 H74 V-14 A14 14 0 0 0 74 14 V40 H-74 V14 A14 14 0 0 0 -74 -14 Z"/><path fill="url(#hatch)" d="M-74 -40 H74 V-14 A14 14 0 0 0 74 14 V40 H-74 V14 A14 14 0 0 0 -74 -14 Z"/><path class="thin" d="M30 -36 V36" stroke-dasharray="6 6"/><path class="ink f-paper" d="M-26 -22 L-18 -6 L0 -4 L-13 8 L-9 26 L-26 17 L-43 26 L-39 8 L-52 -4 L-34 -6 Z"/></g>'
  };
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs, inner) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (inner) n.innerHTML = inner;
    return n;
  }
  /** Small icon for a service id, used in the service cards. */
  function serviceIcon(id, on) {
    var svg = svgEl('svg', { viewBox: '-84 -92 168 176', class: 'icon' + (on ? '' : ' off'), 'aria-hidden': 'true' });
    svg.appendChild(svgEl('g', {}, ICONS[id] || ''));
    return svg;
  }
  function arrowPath(g, x1, y1, x2, y2, on) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var bx = x2 - ux * 26, by = y2 - uy * 26;
    var wrap = svgEl('g', { class: on ? '' : 'off-arrow' });
    var d = 'M' + x1 + ' ' + y1 + ' L' + bx + ' ' + by;
    wrap.appendChild(svgEl('path', { d: d, class: 'arrow-o' }));
    wrap.appendChild(svgEl('path', { d: d, class: 'arrow-i' }));
    wrap.appendChild(svgEl('path', { class: 'arrow-h', d: 'M' + x2 + ' ' + y2 + ' L' + (bx + nx * 18) + ' ' + (by + ny * 18) + ' L' + (bx - nx * 18) + ' ' + (by - ny * 18) + ' Z' }));
    g.appendChild(wrap);
  }

  var phone = window.matchMedia ? window.matchMedia('(max-width: 720px)') : { matches: false };
  /** Phone layout of the hub sketch: Claude on top, one arrow down, services in two columns. */
  function hubSketchPhone(services) {
    var W = 400, rows = Math.ceil(services.length / 2), top = 206, rowH = 92, H = top + rows * rowH + 6;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'phone', role: 'img', 'aria-label': 'Claude connected to ' + services.filter(function (s) { return s.configured; }).length + ' of ' + services.length + ' services' });
    svg.appendChild(svgEl('g', { transform: 'translate(200 52) scale(.8)' }, '<path d="M-14 -38 A40 40 0 1 0 -14 38" fill="none" stroke="#d06c43" stroke-width="20" stroke-linecap="round"/><path class="ink f-sea" d="M20 -36 C6 -42 -6 -30 -4 -20 C-16 -18 -16 -2 -8 2 C-14 14 -2 26 12 22 C16 32 30 30 32 18 L32 -34 Z"/><path class="ink f-sea" d="M36 -36 C50 -42 62 -30 60 -20 C72 -18 72 -2 64 2 C70 14 58 26 44 22 C40 32 28 30 26 18 L26 -30 Z"/>'));
    var t = svgEl('text', { x: 200, y: 118, 'text-anchor': 'middle', class: 'hub-title' }); t.textContent = 'Claude'; svg.appendChild(t);
    svg.appendChild(svgEl('rect', { x: 105, y: 126, width: 190, height: 28, rx: 9, class: 'tag-box' }));
    var tg = svgEl('text', { x: 200, y: 146, 'text-anchor': 'middle', class: 'tag' }); tg.textContent = 'Natural language control'; svg.appendChild(tg);
    var arrows = svgEl('g'); svg.appendChild(arrows);
    arrowPath(arrows, 200, 158, 200, top - 8, true);
    services.forEach(function (s, i) {
      var col = i % 2, row = Math.floor(i / 2), x = 8 + col * 194, y = top + row * rowH;
      if (i === services.length - 1 && col === 0) x = 103; // a lone last card sits in the middle
      var g = svgEl('g', { transform: 'translate(' + x + ' ' + y + ')' });
      g.appendChild(svgEl('rect', { x: 0, y: 4, width: 186, height: 78, rx: 11, class: 'card-box' }));
      g.appendChild(svgEl('g', { transform: 'translate(34 44) scale(.3)', class: s.configured ? '' : 'off' }, ICONS[s.id] || ''));
      var short = s.displayName.split(' (')[0], kind = (/\((.*)\)/.exec(s.displayName) || [])[1] || '';
      var n1 = svgEl('text', { x: 74, y: 40, class: 'name' }); n1.textContent = short; g.appendChild(n1);
      var n2 = svgEl('text', { x: 74, y: 62, class: 'tag' }); n2.textContent = kind; g.appendChild(n2);
      if (s.configured) g.appendChild(svgEl('g', { transform: 'translate(170 10)' }, '<circle r="12" class="check-ring"/><path class="check-tick" d="M-6 0 L-2 5 L7 -6"/>'));
      svg.appendChild(g);
    });
    return svg;
  }
  /** Sketch of Claude in the middle with the services around it; services that are enabled get a check mark. */
  function hubSketch(services) {
    var W = 760, H = 440, cx = 380, cy = 215;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': 'Claude connected to ' + services.filter(function (s) { return s.configured; }).length + ' of ' + services.length + ' services' });
    var slots = [[92, 80], [92, 215], [92, 350], [668, 80], [668, 215], [668, 350], [380, 62]];
    var arrows = svgEl('g'), nodes = svgEl('g');
    svg.appendChild(arrows);
    services.slice(0, slots.length).forEach(function (s, i) {
      var sx = slots[i][0], sy = slots[i][1], left = sx < cx, top = sx === cx;
      var tx = top ? cx : (left ? sx + 120 : sx - 120), ty = top ? sy + 60 : sy;
      var fx = top ? cx : (left ? cx - 90 : cx + 90), fy = top ? cy - 60 : cy + (sy - cy) * 0.3;
      arrowPath(arrows, fx, fy, tx, ty, s.configured);
      var g = svgEl('g', { transform: 'translate(' + sx + ' ' + sy + ')' });
      var ic = svgEl('g', { transform: 'translate(' + (top ? -118 : (left ? -52 : 52)) + ' 0) scale(.42)', class: s.configured ? '' : 'off' }, ICONS[s.id] || '');
      g.appendChild(ic);
      var short = s.displayName.split(' (')[0], kind = (/\((.*)\)/.exec(s.displayName) || [])[1] || '';
      var bx = top ? -20 : (left ? 4 : -112);
      g.appendChild(svgEl('rect', { x: bx, y: -26, width: 112, height: 52, rx: 9, class: 'card-box' }));
      var t1 = svgEl('text', { x: bx + 56, y: -3, 'text-anchor': 'middle', class: 'name' }); t1.textContent = short; g.appendChild(t1);
      var t2 = svgEl('text', { x: bx + 56, y: 16, 'text-anchor': 'middle', class: 'tag' }); t2.textContent = kind; g.appendChild(t2);
      if (s.configured) g.appendChild(svgEl('g', { transform: 'translate(' + (bx + 112 - 12) + ' -30)' }, '<circle r="13" class="check-ring"/><path class="check-tick" d="M-6 0 L-2 5 L7 -6"/>'));
      nodes.appendChild(g);
    });
    svg.appendChild(nodes);
    var hub = svgEl('g', { transform: 'translate(' + cx + ' ' + cy + ')' }, '<path d="M-14 -38 A40 40 0 1 0 -14 38" fill="none" stroke="#d06c43" stroke-width="20" stroke-linecap="round"/><path class="ink f-sea" d="M20 -36 C6 -42 -6 -30 -4 -20 C-16 -18 -16 -2 -8 2 C-14 14 -2 26 12 22 C16 32 30 30 32 18 L32 -34 Z"/><path class="ink f-sea" d="M36 -36 C50 -42 62 -30 60 -20 C72 -18 72 -2 64 2 C70 14 58 26 44 22 C40 32 28 30 26 18 L26 -30 Z"/><text y="76" text-anchor="middle" class="hub-title">Claude</text><rect x="-95" y="86" width="190" height="30" rx="9" class="tag-box"/><text y="107" text-anchor="middle" class="tag">Natural language control</text>');
    svg.appendChild(hub);
    return svg;
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body === undefined ? {} : body);
    }
    return fetch('/admin/api' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data.error || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return data;
      });
    });
  }

  // ---------- WebAuthn (native API, base64url <-> ArrayBuffer) ----------
  function b64uToBuf(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  function bufToB64u(buf) {
    var bytes = new Uint8Array(buf), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function passkeysSupported() {
    return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials);
  }
  function createPasskey(o) {
    var pk = Object.assign({}, o, {
      challenge: b64uToBuf(o.challenge),
      user: Object.assign({}, o.user, { id: b64uToBuf(o.user.id) }),
      excludeCredentials: (o.excludeCredentials || []).map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); })
    });
    return navigator.credentials.create({ publicKey: pk }).then(function (cred) {
      var r = cred.response;
      return {
        id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        response: {
          clientDataJSON: bufToB64u(r.clientDataJSON),
          attestationObject: bufToB64u(r.attestationObject),
          transports: r.getTransports ? r.getTransports() : undefined
        }
      };
    });
  }
  function getPasskey(o) {
    var pk = Object.assign({}, o, {
      challenge: b64uToBuf(o.challenge),
      allowCredentials: (o.allowCredentials || []).map(function (c) { return Object.assign({}, c, { id: b64uToBuf(c.id) }); })
    });
    return navigator.credentials.get({ publicKey: pk }).then(function (cred) {
      var r = cred.response;
      return {
        id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
        authenticatorAttachment: cred.authenticatorAttachment || undefined,
        clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
        response: {
          clientDataJSON: bufToB64u(r.clientDataJSON),
          authenticatorData: bufToB64u(r.authenticatorData),
          signature: bufToB64u(r.signature),
          userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined
        }
      };
    });
  }
  function errorDetail(e) {
    if (!e || !e.name || e.status) return '';
    return ' [' + e.name + (e.message ? ': ' + e.message : '') + ']';
  }
  function friendlyError(e) {
    if (e && e.name === 'NotAllowedError') {
      return 'The passkey request was cancelled or timed out.' + errorDetail(e) +
        ' If you did not cancel it, the browser probably rejected the page: make sure the mcp-arr root certificate is installed and trusted' +
        ' (the address bar must not say "Not secure") and that you opened the configured host name. Then try again, or use a password instead.' +
        (window.isSecureContext ? '' : ' This page is NOT a secure context.');
    }
    if (e && e.name === 'InvalidStateError') return 'This passkey is already registered for this account.' + errorDetail(e);
    if (e && e.name === 'SecurityError') return 'Passkeys are not allowed on this address. Open the web UI via its configured host name (PUBLIC_URL).' + errorDetail(e);
    if (e && e.name === 'NotSupportedError') return 'This browser or device cannot create this kind of passkey.' + errorDetail(e);
    return (e && e.message) || String(e);
  }
  function deviceName() {
    var ua = navigator.userAgent, os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
    var br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser';
    return br + ' on ' + os;
  }
  /** Run a registration ceremony. body: {kind, name?, code?, inviteToken?} */
  function registerPasskey(body, credentialName) {
    return api('POST', '/register/options', body).then(function (start) {
      return createPasskey(start.options).then(function (response) {
        return api('POST', '/register/verify', { flowId: start.flowId, response: response, credentialName: credentialName || deviceName() });
      });
    });
  }
  function signIn() {
    return api('POST', '/login/options').then(function (start) {
      return getPasskey(start.options).then(function (response) {
        return api('POST', '/login/verify', { flowId: start.flowId, response: response });
      });
    });
  }

  // ---------- public views ----------
  function centered(title, intro, body) {
    who.classList.add('hidden');
    app.replaceChildren(el('div', { class: 'center panel' }, [el('h2', { text: title }), intro ? el('p', { class: 'muted', text: intro }) : null].concat(body)));
  }

  function nameForm(opts) {
    var fields = [];
    var code = opts.code ? el('input', { type: 'text', autocomplete: 'off', placeholder: 'XXXXX-XXXXX' }) : null;
    var name = el('input', { type: 'text', autocomplete: 'username', placeholder: 'e.g. Henrik' });
    var password = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    var password2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    var keyName = el('input', { type: 'text', value: deviceName() });
    var msg = el('div', { class: 'msg' });
    var pk = passkeysSupported();
    if (code) fields.push(el('label', { text: opts.codeLabel }), code);
    fields.push(el('label', { text: 'Your name (also your sign-in name)' }), name);
    var buttons = [];
    function done() { if (opts.after) opts.after(); load(); }
    function lock(disabled) { buttons.forEach(function (b) { b.disabled = disabled; }); }
    function baseBody() { return Object.assign({ name: name.value, code: code ? code.value : undefined }, opts.extra || {}); }
    function createWithPasskey() {
      lock(true);
      showMsg(msg, 'warn', 'Follow the prompt from your browser or device…');
      registerPasskey(baseBody(), keyName.value).then(done, function (e) { lock(false); showMsg(msg, 'err', friendlyError(e)); });
    }
    function createWithPassword() {
      if (password.value !== password2.value) { showMsg(msg, 'err', 'The passwords do not match.'); return; }
      lock(true);
      showMsg(msg, 'warn', 'Creating account…');
      api('POST', '/register/password', Object.assign(baseBody(), { password: password.value })).then(done, function (e) { lock(false); showMsg(msg, 'err', e.message); });
    }
    var pkBtn = el('button', { class: 'primary big', type: 'button', text: opts.button, onclick: createWithPasskey });
    var pwBtn = el('button', { class: pk ? 'big' : 'primary big', type: 'button', text: 'Create account with password', onclick: createWithPassword });
    buttons.push(pkBtn, pwBtn);
    if (pk) {
      fields.push(el('h3', { text: 'Passkey (recommended)' }), el('label', { text: 'Name for this passkey' }), keyName, el('div', { class: 'row' }, [pkBtn]));
    } else {
      fields.push(el('div', { class: 'msg warn', text: 'Passkeys are not available on this page (it needs trusted HTTPS on the configured host name). You can use a password for now.' }));
    }
    fields.push(el('h3', { text: pk ? 'Or use a password' : 'Password' }), el('label', { text: 'Password' }), password, el('label', { text: 'Repeat password' }), password2, el('div', { class: 'row' }, [pwBtn]), msg);
    var form = el('form', { onsubmit: function (ev) { ev.preventDefault(); if (pk) createWithPasskey(); else createWithPassword(); } }, fields);
    setTimeout(function () { (code || name).focus(); }, 0);
    return form;
  }

  function renderSetup() {
    centered('Welcome - create the first admin', 'Enter the setup code from the server log (docker compose logs mcp-arr) and register a passkey or choose a password. You will use it to sign in.', [
      nameForm({ code: true, codeLabel: 'Setup code', button: 'Create passkey', extra: { kind: 'setup' } })
    ]);
  }

  function renderRecovery() {
    centered('Admin recovery', 'Enter the recovery code from the server log to create a new admin account (passkey or password). Remove ADMIN_RECOVERY afterwards.', [
      nameForm({ code: true, codeLabel: 'Recovery code', button: 'Create admin passkey', extra: { kind: 'recovery' } }),
      el('div', { class: 'row' }, [el('button', { class: 'link', text: 'Back to sign in', onclick: function () { renderLogin(lastState); } })])
    ]);
  }

  function renderInvite(token) {
    api('POST', '/invite/check', { token: token }).then(function (r) {
      if (!r.valid) {
        centered('Invite not valid', null, [
          el('div', { class: 'msg err', text: 'This invite link is invalid, already used, or has expired. Ask an admin for a new one.' }),
          el('div', { class: 'row' }, [el('button', { text: 'Go to sign in', onclick: function () { location.hash = ''; load(); } })])
        ]);
        return;
      }
      centered('You have been invited', 'Create a passkey or password to join as ' + (r.role === 'admin' ? 'an admin' : 'a user') + '. The invite expires ' + fmtDate(r.expiresAt) + '.', [
        nameForm({ button: 'Create passkey', extra: { kind: 'invite', inviteToken: token }, after: function () { history.replaceState(null, '', '/admin'); } })
      ]);
    }, function (e) { centered('Error', null, [el('div', { class: 'msg err', text: e.message })]); });
  }

  var lastState = null;
  function renderLogin(state) {
    var msg = el('div', { class: 'msg' });
    var pk = passkeysSupported();
    var pkBtn = pk ? el('button', { class: 'primary big', type: 'button', text: 'Sign in with passkey', onclick: function () {
      pkBtn.disabled = true;
      showMsg(msg, 'warn', 'Follow the prompt from your browser or device…');
      signIn().then(load, function (e) { pkBtn.disabled = false; showMsg(msg, 'err', friendlyError(e)); });
    } }) : null;
    var name = el('input', { type: 'text', autocomplete: 'username' });
    var password = el('input', { type: 'password', autocomplete: 'current-password' });
    var pwBtn = el('button', { class: pk ? 'big' : 'primary big', type: 'submit', text: 'Sign in with password' });
    var pwForm = el('form', { onsubmit: function (ev) {
      ev.preventDefault();
      pwBtn.disabled = true;
      api('POST', '/login/password', { name: name.value, password: password.value }).then(load, function (e) {
        pwBtn.disabled = false; showMsg(msg, 'err', e.message);
      });
    } }, [el('label', { text: 'Name' }), name, el('label', { text: 'Password' }), password, el('div', { class: 'row' }, [pwBtn])]);
    centered('Sign in', null, [
      pkBtn,
      pk ? el('p', { class: 'note', text: 'or sign in with your name and password:' }) : el('div', { class: 'msg warn', text: window.isSecureContext
        ? 'This browser does not support passkeys (WebAuthn).'
        : 'Passkeys are not available on this page: it is not loaded over trusted HTTPS. Install the mcp-arr root certificate and open the configured host name.' }),
      pwForm, msg,
      pk ? null : el('div', { class: 'row' }, [el('a', { class: 'button', href: '/ca.crt', text: 'Download root certificate' })]),
      el('p', { class: 'note', text: 'New here? Ask an admin for an invite link.' }),
      state && state.recoveryAvailable ? el('div', { class: 'row' }, [el('button', { class: 'link', text: 'Lost your passkey? Use the recovery code', onclick: renderRecovery })]) : null
    ]);
  }

  // ---------- main views ----------
  function serviceCard(svc, onUpdated) {
    var urlInput = el('input', { type: 'url', value: svc.url, placeholder: svc.exampleUrl, disabled: svc.urlSource === 'env' });
    var keyInput = el('input', {
      type: 'password', autocomplete: 'off', disabled: svc.apiKeySource === 'env',
      placeholder: svc.hasApiKey ? 'Saved' + (svc.apiKeyHint ? ' (ends with ' + svc.apiKeyHint + ')' : '') + ' - leave empty to keep' : 'API key'
    });
    var msg = el('div', { class: 'msg' });
    function payload() {
      var p = {};
      if (svc.urlSource !== 'env') p.url = urlInput.value;
      if (svc.apiKeySource !== 'env' && keyInput.value) p.apiKey = keyInput.value;
      return p;
    }
    var testBtn = el('button', { text: 'Test', onclick: function () {
      testBtn.disabled = true;
      showMsg(msg, 'warn', 'Testing…');
      var body = { url: urlInput.value };
      if (keyInput.value) body.apiKey = keyInput.value;
      api('POST', '/services/' + svc.id + '/test', body).then(function (r) {
        if (r.ok) showMsg(msg, 'ok', 'Connected' + (r.version ? ' - version ' + r.version : ''));
        else showMsg(msg, 'err', r.error || 'Connection failed');
      }, function (e) { showMsg(msg, 'err', e.message); }).then(function () { testBtn.disabled = false; });
    } });
    var saveBtn = el('button', { class: 'primary', text: 'Save', onclick: function () {
      saveBtn.disabled = true;
      api('PUT', '/services/' + svc.id, payload()).then(function (r) { onUpdated(r); }, function (e) {
        saveBtn.disabled = false; showMsg(msg, 'err', e.message);
      });
    } });
    var canRemove = (svc.urlSource === 'file' || svc.apiKeySource === 'file');
    var clearBtn = canRemove ? el('button', { class: 'danger', text: 'Remove', onclick: function () {
      if (!confirm('Remove the saved settings for ' + svc.displayName + '?')) return;
      var p = {};
      if (svc.urlSource !== 'env') p.url = '';
      if (svc.apiKeySource !== 'env') p.apiKey = '';
      api('PUT', '/services/' + svc.id, p).then(onUpdated, function (e) { showMsg(msg, 'err', e.message); });
    } }) : null;
    return el('div', { class: 'panel' }, [
      el('div', { class: 'card-head' }, [el('div', { class: 'card-title' }, [serviceIcon(svc.id, svc.configured), el('strong', { text: svc.displayName })]), el('span', { class: 'pill' + (svc.configured ? ' ok' : ''), text: svc.configured ? 'Enabled' : 'Not configured' })]),
      el('label', { text: 'URL' }), urlInput,
      svc.urlSource === 'env' ? el('div', { class: 'note', text: 'Set by ' + svc.envPrefix + '_URL (read-only here)' }) : null,
      el('label', { text: 'API key' }), keyInput,
      svc.apiKeySource === 'env' ? el('div', { class: 'note', text: 'Set by ' + svc.envPrefix + '_API_KEY (read-only here)' }) : null,
      el('div', { class: 'row' }, [saveBtn, testBtn, clearBtn]),
      msg
    ]);
  }

  function viewServices(d, redraw) {
    var summary = el('p', { class: 'muted', text: d.configuredSummary.length ? 'Enabled: ' + d.configuredSummary.join(', ') : 'No services enabled yet.' });
    if (d.me.role !== 'admin') {
      return [el('section', null, [el('h2', { text: 'Services' }), el('div', { class: 'panel hub' }, [phone.matches ? hubSketchPhone(d.services) : hubSketch(d.services)]), el('div', { class: 'panel' }, [
        el('div', { class: 'pills' }, d.services.map(function (s) { return el('span', { class: 'pill' + (s.configured ? ' ok' : ''), text: s.displayName }); })),
        el('p', { class: 'note', text: 'Only admins can change service settings.' })
      ])])];
    }
    var grid = el('div', { class: 'grid' }, d.services.map(function (s) {
      return serviceCard(s, function (r) { d.services = r.services; d.configuredSummary = r.configuredSummary; redraw(); });
    }));
    return [el('section', null, [el('h2', { text: 'Services' }), el('div', { class: 'panel hub' }, [phone.matches ? hubSketchPhone(d.services) : hubSketch(d.services)]), summary, grid])];
  }

  function viewConnect(d) {
    var endpoint = d.publicUrl + '/mcp';
    var internal = d.tls.mode === 'internal';
    var caHint = internal ? 'NODE_EXTRA_CA_CERTS=/path/to/mcp-arr-ca.crt ' : '';
    var desktop = { mcpServers: { arr: { command: 'npx', args: ['-y', 'mcp-remote', endpoint, '--header', 'Authorization: Bearer <token>'] } } };
    if (internal) desktop.mcpServers.arr.env = { NODE_EXTRA_CA_CERTS: '/path/to/mcp-arr-ca.crt' };
    return el('section', null, [el('h2', { text: 'Connect an MCP client' }), el('div', { class: 'panel' }, [
      el('div', { class: 'muted', text: 'Endpoint (Streamable HTTP over HTTPS):' }), el('pre', { text: endpoint }),
      el('p', { class: 'muted', text: 'Create an access token under "Access tokens" and send it as "Authorization: Bearer <token>". Clients that cannot send headers can use ' + endpoint + '?token=<token>.' }),
      internal ? el('div', { class: 'msg warn', text: 'This server uses the built-in certificate authority. Node-based clients (Claude Code, mcp-remote) need NODE_EXTRA_CA_CERTS pointing to the downloaded root certificate - see "Certificates".' }) : null,
      el('h3', { text: 'Claude Code' }),
      el('pre', { text: caHint + 'claude mcp add --transport http arr ' + endpoint + ' --header "Authorization: Bearer <token>"' }),
      internal ? el('p', { class: 'note', text: 'Set NODE_EXTRA_CA_CERTS in the environment that starts claude (e.g. your shell profile).' }) : null,
      el('h3', { text: 'Claude Desktop (via mcp-remote)' }),
      el('pre', { text: JSON.stringify(desktop, null, 2) }),
      el('p', { class: 'note', text: 'Claude "custom connectors" are called from Anthropic’s cloud and need a public internet address, so they cannot reach this offline server. Use the local configurations above.' })
    ])]);
  }

  function viewTokens(d, redraw) {
    var isAdmin = d.me.role === 'admin';
    var newToken = el('div');
    var rows = d.tokens.map(function (t) {
      return el('tr', null, [
        el('td', { text: t.name }),
        isAdmin ? el('td', { text: t.own ? 'you' : t.owner }) : null,
        el('td', null, [el('code', { text: '…' + t.hint })]),
        el('td', { text: fmtDate(t.createdAt) }),
        el('td', { text: fmtDate(t.lastUsedAt) }),
        el('td', null, [el('button', { class: 'danger', text: 'Revoke', onclick: function () {
          if (!confirm('Revoke token "' + t.name + '"? Clients using it lose access immediately.')) return;
          api('DELETE', '/tokens/' + t.id).then(function (r) { d.tokens = r.tokens; redraw(); });
        } })])
      ]);
    });
    var nameInput = el('input', { type: 'text', placeholder: 'e.g. Claude Desktop on laptop' });
    var msg = el('div', { class: 'msg' });
    var form = el('form', { onsubmit: function (ev) {
      ev.preventDefault();
      api('POST', '/tokens', { name: nameInput.value }).then(function (r) {
        d.tokens = r.tokens;
        redraw();
        var box = document.getElementById('new-token');
        if (box) box.replaceChildren(
          el('div', { class: 'msg ok', text: 'Token created. Copy it now - it will not be shown again.' }),
          el('div', { class: 'row' }, [el('code', { text: r.token }), copyButton(function () { return r.token; })])
        );
      }, function (e) { showMsg(msg, 'err', e.message); });
    } }, [el('label', { text: 'New token name' }), nameInput, el('div', { class: 'row' }, [el('button', { class: 'primary', type: 'submit', text: 'Create token' })]), msg]);
    newToken.id = 'new-token';
    return el('section', null, [el('h2', { text: isAdmin ? 'Access tokens (all users)' : 'My access tokens' }), el('div', { class: 'panel' }, [
      el('p', { class: 'muted', text: 'Tokens let MCP clients act as you. Each client should get its own token.' }),
      rows.length ? el('div', { class: 'table-wrap' }, [el('table', null, [
        el('thead', null, [el('tr', null, [el('th', { text: 'Name' }), isAdmin ? el('th', { text: 'Owner' }) : null, el('th', { text: 'Token' }), el('th', { text: 'Created' }), el('th', { text: 'Last used' }), el('th')])]),
        el('tbody', null, rows)
      ])]) : el('div', { class: 'msg warn', text: 'No tokens yet - MCP clients cannot connect until you create one.' }),
      form, newToken
    ])]);
  }

  function viewPasskeys(d, redraw) {
    var msg = el('div', { class: 'msg' });
    var rows = d.me.credentials.map(function (c) {
      return el('tr', null, [
        el('td', { text: c.name }),
        el('td', { text: fmtDate(c.createdAt) }),
        el('td', { text: fmtDate(c.lastUsedAt) }),
        el('td', null, [
          el('button', { text: 'Rename', onclick: function () {
            var n = prompt('New name for this passkey', c.name);
            if (!n) return;
            api('PATCH', '/me/passkeys/' + c.id, { name: n }).then(function (r) { Object.assign(d, r); redraw(); }, function (e) { showMsg(msg, 'err', e.message); });
          } }), ' ',
          (d.me.credentials.length > 1 || d.me.hasPassword) ? el('button', { class: 'danger', text: 'Remove', onclick: function () {
            if (!confirm('Remove passkey "' + c.name + '"?')) return;
            api('DELETE', '/me/passkeys/' + c.id).then(function (r) { Object.assign(d, r); redraw(); }, function (e) { showMsg(msg, 'err', e.message); });
          } }) : null
        ])
      ]);
    });
    var keyName = el('input', { type: 'text', value: deviceName() });
    var add = el('button', { class: 'primary', text: 'Add a passkey', onclick: function () {
      add.disabled = true;
      showMsg(msg, 'warn', 'Follow the prompt from your browser or device…');
      registerPasskey({ kind: 'add' }, keyName.value).then(function () {
        return api('GET', '/overview').then(function (r) { Object.assign(d, r); redraw(); });
      }, function (e) { add.disabled = false; showMsg(msg, 'err', friendlyError(e)); });
    } });
    var pkSupported = passkeysSupported();
    var pwMsg = el('div', { class: 'msg' });
    var curPw = el('input', { type: 'password', autocomplete: 'current-password' });
    var newPw = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'At least 8 characters' });
    var newPw2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Repeat password' });
    var savePw = el('button', { class: 'primary', text: d.me.hasPassword ? 'Change password' : 'Set password', onclick: function () {
      if (newPw.value !== newPw2.value) { showMsg(pwMsg, 'err', 'The passwords do not match.'); return; }
      savePw.disabled = true;
      api('PUT', '/me/password', { password: newPw.value, currentPassword: d.me.hasPassword ? curPw.value : undefined }).then(function (r) {
        Object.assign(d, r); redraw();
      }, function (e) { savePw.disabled = false; showMsg(pwMsg, 'err', e.message); });
    } });
    var dropPw = (d.me.hasPassword && d.me.credentials.length > 0) ? el('button', { class: 'danger', text: 'Remove password', onclick: function () {
      if (!confirm('Remove your password? You will only be able to sign in with a passkey.')) return;
      api('DELETE', '/me/password').then(function (r) { Object.assign(d, r); redraw(); }, function (e) { showMsg(pwMsg, 'err', e.message); });
    } }) : null;
    return el('section', null, [el('h2', { text: 'My sign-in' }), el('div', { class: 'panel' }, [
      el('h3', { text: 'Passkeys' }),
      el('p', { class: 'muted', text: 'Register more than one passkey (e.g. phone and laptop) so you do not get locked out.' }),
      rows.length ? el('div', { class: 'table-wrap' }, [el('table', null, [
        el('thead', null, [el('tr', null, [el('th', { text: 'Name' }), el('th', { text: 'Created' }), el('th', { text: 'Last used' }), el('th')])]),
        el('tbody', null, rows)
      ])]) : el('p', { class: 'note', text: 'No passkeys yet.' }),
      pkSupported ? el('label', { text: 'Name for the new passkey' }) : null, pkSupported ? keyName : null,
      pkSupported ? el('div', { class: 'row' }, [add]) : el('div', { class: 'msg warn', text: 'Passkeys need trusted HTTPS on the configured host name.' }),
      msg
    ]), el('div', { class: 'panel' }, [
      el('h3', { text: 'Password' }),
      el('p', { class: 'muted', text: d.me.hasPassword ? 'You can sign in with your name (' + d.me.name + ') and password.' : 'Optional: sign in with your name (' + d.me.name + ') and a password instead of a passkey.' }),
      d.me.hasPassword ? el('label', { text: 'Current password' }) : null, d.me.hasPassword ? curPw : null,
      el('label', { text: 'New password' }), newPw, el('label', { text: 'Repeat new password' }), newPw2,
      el('div', { class: 'row' }, [savePw, dropPw]), pwMsg
    ])]);
  }

  function viewUsers(d, redraw) {
    var msg = el('div', { class: 'msg' });
    function update(r) { Object.assign(d, r); redraw(); }
    var rows = d.users.map(function (u) {
      var me = u.id === d.me.id;
      var roleSel = el('select', { disabled: me, onchange: function () {
        api('PATCH', '/users/' + u.id, { role: roleSel.value }).then(update, function (e) { showMsg(msg, 'err', e.message); roleSel.value = u.role; });
      } }, [el('option', { value: 'admin', text: 'admin' }), el('option', { value: 'user', text: 'user' })]);
      roleSel.value = u.role;
      return el('tr', null, [
        el('td', { text: u.name + (me ? ' (you)' : '') }),
        el('td', null, [roleSel]),
        el('td', { text: String(u.passkeys) + (u.hasPassword ? ' + password' : '') }),
        el('td', { text: fmtDate(u.createdAt) }),
        el('td', null, [me ? null : el('button', { class: 'danger', text: 'Delete', onclick: function () {
          if (!confirm('Delete user "' + u.name + '"? Their passkeys and access tokens stop working immediately.')) return;
          api('DELETE', '/users/' + u.id).then(update, function (e) { showMsg(msg, 'err', e.message); });
        } })])
      ]);
    });

    var inviteBox = el('div');
    var roleSel = el('select', null, [el('option', { value: 'user', text: 'user' }), el('option', { value: 'admin', text: 'admin' })]);
    var invites = d.invites.map(function (i) {
      return el('tr', null, [
        el('td', { text: i.role }), el('td', { text: fmtDate(i.createdAt) }), el('td', { text: fmtDate(i.expiresAt) }),
        el('td', null, [el('button', { class: 'danger', text: 'Revoke', onclick: function () { api('DELETE', '/invites/' + i.id).then(update); } })])
      ]);
    });
    return el('section', null, [
      el('h2', { text: 'Users' }),
      el('div', { class: 'panel' }, [
        el('div', { class: 'table-wrap' }, [el('table', null, [
          el('thead', null, [el('tr', null, [el('th', { text: 'Name' }), el('th', { text: 'Role' }), el('th', { text: 'Sign-in' }), el('th', { text: 'Created' }), el('th')])]),
          el('tbody', null, rows)
        ])]),
        el('p', { class: 'note', text: 'Admins manage services, users and certificates. Users can only manage their own passkeys and access tokens.' }),
        msg
      ]),
      el('h2', { text: 'Invite someone' }),
      el('div', { class: 'panel' }, [
        el('p', { class: 'muted', text: 'Invite links are single-use and expire after 24 hours. Send the link over a channel you trust.' }),
        el('label', { text: 'Role' }), roleSel,
        el('div', { class: 'row' }, [el('button', { class: 'primary', text: 'Create invite link', onclick: function () {
          api('POST', '/invites', { role: roleSel.value }).then(function (r) {
            Object.assign(d, r.overview);
            redraw();
            var box = document.getElementById('invite-link');
            if (box) box.replaceChildren(el('div', { class: 'msg ok', text: 'Invite link (shown once):' }), el('div', { class: 'row' }, [el('code', { text: r.link }), copyButton(function () { return r.link; })]));
          });
        } })]),
        (function () { inviteBox.id = 'invite-link'; return inviteBox; })(),
        invites.length ? el('h3', { text: 'Pending invites' }) : null,
        invites.length ? el('div', { class: 'table-wrap' }, [el('table', null, [
          el('thead', null, [el('tr', null, [el('th', { text: 'Role' }), el('th', { text: 'Created' }), el('th', { text: 'Expires' }), el('th')])]),
          el('tbody', null, invites)
        ])]) : null
      ])
    ]);
  }

  function viewCertificates(d) {
    var t = d.tls;
    var items = [];
    if (t.mode === 'internal' && t.ca) {
      items.push(
        el('p', { text: 'This server uses its own certificate authority, so it works without internet access. Install the root certificate once on every device that opens the web UI or runs an MCP client.' }),
        el('div', { class: 'row' }, [el('a', { class: 'button primary', href: '/ca.crt', text: 'Download root certificate' })]),
        el('h3', { text: 'Verify the fingerprint (SHA-256)' }),
        el('pre', { text: t.ca.fingerprint256 }),
        el('p', { class: 'note', text: 'Compare it with the fingerprint printed in the server log before trusting the certificate.' }),
        el('p', { class: 'note', text: 'The CA is restricted (name constraints) to: ' + t.ca.permitted.join(', ') + ' - it cannot be used to impersonate other websites.' }),
        el('h3', { text: 'How to install it' }),
        el('details', null, [el('summary', { text: 'macOS' }), el('div', { text: 'Open the file, add it to the System keychain, then double-click it in Keychain Access → Trust → "Always Trust".' })]),
        el('details', null, [el('summary', { text: 'Windows' }), el('div', { text: 'Double-click the file → Install Certificate → Local Machine → "Trusted Root Certification Authorities".' })]),
        el('details', null, [el('summary', { text: 'iPhone / iPad' }), el('div', { text: 'Open the file in Safari, install the profile in Settings → General → VPN & Device Management, then enable it in Settings → General → About → Certificate Trust Settings.' })]),
        el('details', null, [el('summary', { text: 'Android' }), el('div', { text: 'Settings → Security → Encryption & credentials → Install a certificate → CA certificate.' })]),
        el('details', null, [el('summary', { text: 'Linux' }), el('div', { text: 'Debian/Ubuntu: copy to /usr/local/share/ca-certificates/mcp-arr-ca.crt and run update-ca-certificates. Firefox and Chrome on Linux may need it imported in their own certificate settings.' })]),
        el('details', null, [el('summary', { text: 'Claude Code / mcp-remote (Node.js)' }), el('div', { text: 'Node.js does not use the system certificate store by default. Set NODE_EXTRA_CA_CERTS=/path/to/mcp-arr-ca.crt in the environment of the client.' })])
      );
    } else if (t.mode === 'file') {
      items.push(el('p', { text: 'Using your own certificate from ' + t.certFile + ' (reloaded automatically when the file changes).' }));
    } else {
      items.push(el('p', { text: 'TLS is terminated by a reverse proxy (TLS_MODE=off).' }));
    }
    if (t.leaf) {
      items.push(el('h3', { text: 'Server certificate' }), el('div', { class: 'table-wrap' }, [el('table', null, [el('tbody', null, [
        el('tr', null, [el('th', { text: 'Names' }), el('td', { text: t.leaf.sans.join(', ') })]),
        el('tr', null, [el('th', { text: 'Valid until' }), el('td', { text: fmtDate(t.leaf.notAfter) + (t.mode === 'internal' ? ' (renewed automatically)' : '') })]),
        el('tr', null, [el('th', { text: 'Issuer' }), el('td', { text: t.leaf.issuer })])
      ])])]));
    }
    if (t.lastError) items.push(el('div', { class: 'msg err', text: t.lastError }));
    return el('section', null, [el('h2', { text: 'Certificates' }), el('div', { class: 'panel' }, items)]);
  }

  function viewSecurity(d) {
    var s = d.security;
    var src = { env: 'CONFIG_ENCRYPTION_KEY', 'env-file': 'CONFIG_ENCRYPTION_KEY_FILE', 'key-file': 'auto-generated key file (' + s.keyFilePath + ')' }[s.keySource] || s.keySource;
    return el('section', null, [el('h2', { text: 'Security' }), el('div', { class: 'panel' }, [
      el('p', null, ['All settings, API keys, users and certificate keys are encrypted at rest (AES-256-GCM) in ', el('code', { text: s.configPath }), '.']),
      el('p', null, ['Encryption key: ', el('strong', { text: src })]),
      s.warnings.map(function (w) { return el('div', { class: 'msg warn', text: w }); }),
      s.trustProxy ? el('p', { class: 'note', text: 'TRUST_PROXY is on (client IPs from X-Forwarded-For)' }) : null
    ].reduce(function (a, b) { return a.concat(b); }, []))]);
  }


  var redrawNow = null;
  // Switching between phone and desktop width (rotating a tablet, resizing) redraws the current tab.
  if (phone.addEventListener) phone.addEventListener('change', function () { if (redrawNow) redrawNow(); });
  else if (phone.addListener) phone.addListener(function () { if (redrawNow) redrawNow(); });
  /** Copy each column heading onto its cells so the phone layout can show it ("stack" tables only have heading rows). */
  function labelTables(root) {
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (t) {
      var heads = Array.prototype.map.call(t.querySelectorAll('thead th'), function (th) { return th.textContent; });
      if (!heads.length) return;
      t.classList.add('stack');
      Array.prototype.forEach.call(t.querySelectorAll('tbody tr'), function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
      });
    });
  }

  function renderMain(d) {
    who.classList.remove('hidden');
    whoName.textContent = d.me.name + ' · ' + d.me.role;
    var isAdmin = d.me.role === 'admin';
    var tabs = [['services', 'Services'], ['connect', 'Connect'], ['tokens', 'Access tokens'], ['passkeys', 'My sign-in']];
    if (isAdmin) tabs.push(['users', 'Users'], ['certificates', 'Certificates'], ['security', 'Security']);
    else tabs.push(['certificates', 'Certificates']);
    if (!tabs.some(function (t) { return t[0] === currentTab; })) currentTab = 'services';
    var content = el('div');
    var nav = el('nav', { class: 'tabs' });
    function redraw() {
      nav.replaceChildren.apply(nav, tabs.map(function (t) {
        return el('button', { class: t[0] === currentTab ? 'active' : '', text: t[1], onclick: function () { currentTab = t[0]; redraw(); } });
      }));
      var view;
      switch (currentTab) {
        case 'services': view = viewServices(d, redraw); break;
        case 'connect': view = [viewConnect(d)]; break;
        case 'tokens': view = [viewTokens(d, redraw)]; break;
        case 'passkeys': view = [viewPasskeys(d, redraw)]; break;
        case 'users': view = [viewUsers(d, redraw)]; break;
        case 'certificates': view = [viewCertificates(d)]; break;
        case 'security': view = [viewSecurity(d)]; break;
      }
      content.replaceChildren.apply(content, view);
      labelTables(content);
      redrawNow = redraw;
    }
    redraw();
    app.replaceChildren(nav, content);
  }

  function load() {
    var m = /invite=([A-Za-z0-9_-]+)/.exec(location.hash);
    return api('GET', '/state').then(function (s) {
      lastState = s;
      if (m && !s.user) return renderInvite(m[1]);
      if (s.setupRequired) return renderSetup();
      if (!s.user) return renderLogin(s);
      return api('GET', '/overview').then(renderMain);
    }).catch(function (e) {
      if (e.status === 401) return renderLogin(lastState);
      app.replaceChildren(el('div', { class: 'msg err', text: 'Error: ' + e.message }));
    });
  }

  document.getElementById('logout').addEventListener('click', function () { api('POST', '/logout').then(load); });
  load();
})();
</script>
</body>
</html>
`;

export function renderAdminPage(nonce: string): string {
  return PAGE.split('__NONCE__').join(nonce);
}
