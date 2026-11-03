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
input[type=text], input[type=password], input[type=url], input[type=number], input[type=email], select {
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
label.check { display: flex; gap: 10px; align-items: flex-start; color: var(--text); font-size: 14px; margin: 12px 0 3px; cursor: pointer; }
label.check input { width: 20px; height: 20px; flex: none; margin: 0; accent-color: var(--accent-deep); }
.setting { margin-bottom: 6px; }
.setting .src { font-size: 11px; margin-left: 6px; }
.setting .help { font-size: 12px; color: var(--muted); margin-top: 3px; }
pre.testlog { max-height: 260px; overflow-y: auto; }
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

/* ---- live activity on the hub sketch ---- */
.hub { position: relative; }
.hub .node, .hub .brain { transform-box: fill-box; transform-origin: center; }
.hub .arrow.flow .arrow-i { stroke: var(--gold); stroke-dasharray: 4 16; animation: ink-flow .55s linear infinite; }
.hub .arrow.flow .arrow-h { fill: var(--gold); }
.hub .arrow.flow.off-arrow { opacity: .8; }
.hub .brain.think { animation: think .9s ease-in-out infinite; }
.hub .node.pop { animation: hop .6s cubic-bezier(.3, 1.6, .5, 1); }
.hub .node.shake { animation: shake .5s ease-in-out; }
.hub .float { font: 700 22px var(--hand); text-anchor: middle; animation: float-up 1.3s ease-out forwards; pointer-events: none; }
.hub .float.ok { fill: var(--ok); } .hub .float.err { fill: var(--err); }
@keyframes ink-flow { to { stroke-dashoffset: -40; } }
@keyframes think { 0%, 100% { transform: rotate(0) scale(1); } 30% { transform: rotate(-4deg) scale(1.05); } 70% { transform: rotate(3deg) scale(1.03); } }
@keyframes hop { 0% { transform: translateY(0); } 35% { transform: translateY(-9px) rotate(-2deg); } 70% { transform: translateY(2px) rotate(1deg); } 100% { transform: translateY(0); } }
@keyframes shake { 0%, 100% { transform: translateX(0); } 20%, 60% { transform: translateX(-6px) rotate(-1.5deg); } 40%, 80% { transform: translateX(6px) rotate(1.5deg); } }
@keyframes float-up { 0% { opacity: 0; transform: translateY(6px) scale(.7); } 20% { opacity: 1; transform: translateY(0) scale(1.15); } 100% { opacity: 0; transform: translateY(-34px) scale(1); } }
.live-pill { position: absolute; top: 10px; right: 12px; display: flex; align-items: center; gap: 6px; font: 700 13px var(--hand); color: var(--muted); }
.live-pill .dot { width: 10px; height: 10px; border-radius: 50%; border: 2px solid var(--border); background: var(--steel); }
.live-pill.on .dot { background: var(--accent); animation: blink 1.6s ease-in-out infinite; }
.live-pill.static { position: static; }
.live-pill.busy { color: var(--accent-deep); }
@keyframes blink { 50% { opacity: .35; } }

/* ---- status board ---- */
.board-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
.tile { text-align: center; padding: 12px 8px 10px; margin: 0; }
.tile:nth-child(odd) { transform: rotate(-.7deg); } .tile:nth-child(even) { transform: rotate(.6deg); }
.tile .num { font: 700 34px/1.15 var(--hand); color: var(--text); display: inline-block; }
.tile .num.bump { animation: bump .55s cubic-bezier(.3, 1.6, .5, 1); color: var(--accent-deep); }
.tile .lbl { font: 700 14px var(--hand); color: var(--muted); }
.tile .tiny { font-size: 12px; color: var(--muted); }
.tile svg { display: block; margin: 0 auto 2px; width: 34px; height: 24px; }
@keyframes bump { 0% { transform: scale(1); } 40% { transform: scale(1.3) rotate(-4deg); } 100% { transform: scale(1); } }
.board-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; margin-bottom: 18px; }
.board-grid .panel { margin: 0; }
.bars { list-style: none; margin: 0; padding: 0; }
.bars li { display: grid; grid-template-columns: 40px 1fr; gap: 4px 10px; align-items: center; padding: 7px 0; border-bottom: 1.5px dashed var(--line); }
.bars li:last-child { border-bottom: none; }
.bars svg.icon { width: 40px; height: 34px; grid-row: span 2; }
.bars .bar-label { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; }
.bars .bar-label strong { font: 700 15px var(--hand); }
.track { height: 16px; border: 2px solid var(--border); border-radius: 8px 10px 7px 9px; background: var(--input); overflow: hidden; }
.track .fill { height: 100%; min-width: 3px; background-color: var(--accent); background-image: repeating-linear-gradient(38deg, transparent 0 6px, rgba(59, 50, 42, .28) 6px 7.5px); border-right: 2px solid var(--border); transition: width .6s cubic-bezier(.3, 1.4, .5, 1); }
.track .fill.err { background-color: var(--err); }
.track.small { height: 10px; border-width: 1.5px; }
.chart svg { display: block; width: 100%; height: auto; }
.chart .bar { fill: var(--sea); stroke: var(--text); stroke-width: 2; stroke-linejoin: round; }
.chart .bar.now { fill: var(--accent); }
.chart .bar-hit { fill: transparent; }
.chart .bar-hit:hover + .bar, .chart .bar:hover { fill: var(--gold); }
.chart .axis { stroke: var(--text); stroke-width: 2.5; stroke-linecap: round; fill: none; }
.chart .grid { stroke: var(--line); stroke-width: 1.5; stroke-dasharray: 5 6; }
.chart text { font: 12px var(--hand); fill: var(--muted); }
.feed { list-style: none; margin: 0; padding: 0; max-height: 330px; overflow-y: auto; }
.feed li { display: grid; grid-template-columns: auto 30px 1fr auto; gap: 2px 8px; align-items: center; padding: 6px 2px; border-bottom: 1.5px dashed var(--line); font-size: 13px; }
.feed li.new { animation: slide-in .6s cubic-bezier(.3, 1.4, .5, 1); background: var(--sea-pale); border-radius: 8px; }
.feed svg.icon { width: 30px; height: 26px; }
.feed .t { font-family: var(--mono); font-size: 12px; color: var(--muted); }
.feed .tool { font-family: var(--mono); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.feed .meta { grid-column: 3 / 5; color: var(--muted); font-size: 12px; }
.mark { font: 700 13px var(--hand); white-space: nowrap; }
.mark.ok { color: var(--ok); } .mark.err { color: var(--err); }
@keyframes slide-in { 0% { opacity: 0; transform: translateX(-24px) rotate(-1deg); } 100% { opacity: 1; transform: none; } }
.toplist { list-style: none; margin: 0; padding: 0; counter-reset: top; }
.toplist li { display: grid; grid-template-columns: 26px 1fr auto; gap: 2px 8px; align-items: center; padding: 5px 0; counter-increment: top; }
.toplist li::before { content: counter(top); font: 700 16px var(--hand); color: var(--accent-deep); grid-row: span 2; }
.toplist code { word-break: break-all; }
.toplist .track { grid-column: 2 / 4; }
.toplist.apps li { grid-template-columns: 26px 1fr auto; }
.app-name { display: flex; flex-direction: column; min-width: 0; }
.app-name strong { font: 700 15px var(--hand); overflow-wrap: anywhere; }
.board-grid .pills { margin-bottom: 8px; }
.empty { text-align: center; color: var(--muted); padding: 18px 8px; }
.empty svg { width: 90px; height: 64px; display: block; margin: 0 auto 6px; }

/* ---- brand guide ---- */
.theme-light { --bg: #e6d6b2; --paper: #f4ead3; --panel: #f9f1de; --text: #3b322a; --muted: #7a6b5b; --border: #3b322a; --line: #d9c9a4; --accent: #d06c43; --accent-deep: #8f4425; --sea: #5f9e96; --sea-pale: #cfe5df; --gold: #e3a979; --steel: #b9b4aa; color: var(--text); }
.theme-dark { --bg: #1f1b16; --paper: #29251f; --panel: #322c24; --text: #f1e6cf; --muted: #b5a78f; --border: #8a7c66; --line: #43392d; --accent: #e07f55; --accent-deep: #f2a07b; --sea: #78bab1; --sea-pale: #2f5752; --gold: #c98c5e; --steel: #6d685f; color: var(--text); }
.brand-hero { display: flex; align-items: center; gap: 22px; flex-wrap: wrap; }
.brand-hero svg { width: 190px; height: 118px; flex: none; }
.brand-hero h2 { font-size: 40px; margin: 0; letter-spacing: 2px; }
.brand-hero .tagline { font: 700 18px var(--hand); color: var(--muted); }
.stages { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.stage { border: 2.5px solid var(--border); border-radius: 14px 18px 12px 16px; padding: 18px 12px 10px; text-align: center; background: var(--paper); position: relative; }
.stage svg.logo { width: 120px; height: 76px; display: block; margin: 0 auto; }
.stage .cap { font: 700 13px var(--hand); color: var(--muted); margin-top: 6px; }
.stage.clear { outline: 2px dashed var(--accent); outline-offset: -14px; }
.stage.dont svg.logo { opacity: .9; }
.stage .nope { position: absolute; top: 6px; right: 8px; width: 30px; height: 30px; }
.dont-stretch svg.logo { transform: scale(1.45, .7); }
.dont-tilt svg.logo { transform: rotate(-24deg); }
.dont-recolor svg.logo { filter: hue-rotate(150deg) saturate(2); }
.dont-busy { background-image: repeating-linear-gradient(45deg, var(--accent) 0 8px, var(--gold) 8px 16px, var(--sea) 16px 24px) !important; }
.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
.chip { border: 2.5px solid var(--border); border-radius: 12px 16px 10px 14px; background: var(--paper); padding: 8px; box-shadow: 3px 4px 0 var(--shadow); cursor: pointer; text-align: left; font: inherit; color: var(--text); }
.chip:hover { transform: rotate(-1deg) translateY(-2px); background: var(--paper); }
.chip .split { display: flex; height: 64px; border: 2px solid var(--border); border-radius: 8px 11px 7px 10px; overflow: hidden; margin-bottom: 6px; }
.chip .split span { flex: 1; }
.chip strong { font: 700 16px var(--hand); display: block; }
.chip code { font-size: 12px; color: var(--muted); }
.chip .use { font-size: 12px; color: var(--muted); line-height: 1.35; margin-top: 3px; }
.type-row { display: grid; grid-template-columns: 140px 1fr; gap: 10px; align-items: baseline; padding: 8px 0; border-bottom: 1.5px dashed var(--line); }
.type-row:last-child { border-bottom: none; }
.type-row .spec { font-size: 12px; color: var(--muted); }
.t-display { font: 700 40px/1.1 var(--hand); letter-spacing: 2px; }
.t-h2 { font: 700 22px/1.2 var(--hand); } .t-h3 { font: 700 16px/1.3 var(--hand); }
.shapes { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 18px; }
.shape-demo { min-height: 110px; display: flex; flex-direction: column; justify-content: flex-end; }
.shape-demo.hard { box-shadow: 8px 9px 0 var(--accent); }
.shape-demo.hatchy { background-color: var(--sea-pale); background-image: repeating-linear-gradient(38deg, transparent 0 8px, rgba(59, 50, 42, .25) 8px 9.5px); }
.shape-demo.inky { border-width: 4px; border-style: solid; }
.icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 12px; }
.icon-cell { text-align: center; font: 700 14px var(--hand); }
.icon-cell svg { width: 80px; height: 68px; display: block; margin: 0 auto; }
.icon-cell:hover svg { animation: hop .6s cubic-bezier(.3, 1.6, .5, 1); }
.dodont { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.dodont .do, .dodont .dont-say { border: 2px solid var(--ok); border-radius: 12px 15px 11px 14px; padding: 8px 12px; background: var(--ok-bg); }
.dodont .dont-say { border-color: var(--err); background: var(--err-bg); }
.dodont strong { font: 700 15px var(--hand); }
.dodont .do strong { color: var(--ok); } .dodont .dont-say strong { color: var(--err); }
.dodont p { margin: 4px 0; }
.toc { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }

@media (prefers-reduced-motion: reduce) {
  .hub .arrow.flow .arrow-i, .hub .brain.think, .hub .node.pop, .hub .node.shake, .tile .num.bump, .feed li.new, .live-pill.on .dot, .icon-cell:hover svg { animation: none; }
  .hub .float { animation: fade-out 1.3s forwards; }
  .track .fill { transition: none; }
}
@keyframes fade-out { 0% { opacity: 1; } 100% { opacity: 0; } }

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
@media (max-width: 720px) {
  .tiles { grid-template-columns: repeat(2, 1fr); gap: 10px; }
  .tile .num { font-size: 28px; }
  .board-grid { grid-template-columns: 1fr; }
  .type-row { grid-template-columns: 1fr; gap: 2px; }
  .dodont { grid-template-columns: 1fr; }
  .brand-hero svg { width: 130px; height: 82px; }
  .brand-hero h2 { font-size: 30px; }
  .live-pill { top: 6px; right: 8px; }
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
  /** The Claude mark (terracotta C + sea-glass brain), centred on 0,0. */
  var CLAUDE_MARK = '<path d="M-14 -38 A40 40 0 1 0 -14 38" fill="none" stroke="#d06c43" stroke-width="20" stroke-linecap="round"/><path class="ink f-sea" d="M20 -36 C6 -42 -6 -30 -4 -20 C-16 -18 -16 -2 -8 2 C-14 14 -2 26 12 22 C16 32 30 30 32 18 L32 -34 Z"/><path class="ink f-sea" d="M36 -36 C50 -42 62 -30 60 -20 C72 -18 72 -2 64 2 C70 14 58 26 44 22 C40 32 28 30 26 18 L26 -30 Z"/>';
  ICONS.core = '<g transform="translate(-14 0) scale(1.25)">' + CLAUDE_MARK + '</g>';
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
  function arrowPath(g, x1, y1, x2, y2, on, key) {
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy), ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
    var bx = x2 - ux * 26, by = y2 - uy * 26;
    var wrap = svgEl('g', { class: 'arrow' + (on ? '' : ' off-arrow'), 'data-svc': key || 'all' });
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
    var brainWrap = svgEl('g', { transform: 'translate(200 52) scale(.8)' });
    brainWrap.appendChild(svgEl('g', { class: 'brain', 'data-fx': 0, 'data-fy': -50 }, CLAUDE_MARK));
    svg.appendChild(brainWrap);
    var t = svgEl('text', { x: 200, y: 118, 'text-anchor': 'middle', class: 'hub-title' }); t.textContent = 'Claude'; svg.appendChild(t);
    svg.appendChild(svgEl('rect', { x: 105, y: 126, width: 190, height: 28, rx: 9, class: 'tag-box' }));
    var tg = svgEl('text', { x: 200, y: 146, 'text-anchor': 'middle', class: 'tag' }); tg.textContent = 'Natural language control'; svg.appendChild(tg);
    var arrows = svgEl('g'); svg.appendChild(arrows);
    arrowPath(arrows, 200, 158, 200, top - 8, true);
    services.forEach(function (s, i) {
      var col = i % 2, row = Math.floor(i / 2), x = 8 + col * 194, y = top + row * rowH;
      if (i === services.length - 1 && col === 0) x = 103; // a lone last card sits in the middle
      var outer = svgEl('g', { transform: 'translate(' + x + ' ' + y + ')' });
      var g = svgEl('g', { class: 'node', 'data-svc': s.id, 'data-fx': 93, 'data-fy': 0 });
      outer.appendChild(g);
      g.appendChild(svgEl('rect', { x: 0, y: 4, width: 186, height: 78, rx: 11, class: 'card-box' }));
      g.appendChild(svgEl('g', { transform: 'translate(34 44) scale(.3)', class: s.configured ? '' : 'off' }, ICONS[s.id] || ''));
      var short = s.displayName.split(' (')[0], kind = (/\((.*)\)/.exec(s.displayName) || [])[1] || '';
      var n1 = svgEl('text', { x: 74, y: 40, class: 'name' }); n1.textContent = short; g.appendChild(n1);
      var n2 = svgEl('text', { x: 74, y: 62, class: 'tag' }); n2.textContent = kind; g.appendChild(n2);
      if (s.configured) g.appendChild(svgEl('g', { transform: 'translate(170 10)' }, '<circle r="12" class="check-ring"/><path class="check-tick" d="M-6 0 L-2 5 L7 -6"/>'));
      svg.appendChild(outer);
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
      arrowPath(arrows, fx, fy, tx, ty, s.configured, s.id);
      var outer = svgEl('g', { transform: 'translate(' + sx + ' ' + sy + ')' });
      var g = svgEl('g', { class: 'node', 'data-svc': s.id });
      outer.appendChild(g);
      var ic = svgEl('g', { transform: 'translate(' + (top ? -118 : (left ? -52 : 52)) + ' 0) scale(.42)', class: s.configured ? '' : 'off' }, ICONS[s.id] || '');
      g.appendChild(ic);
      var short = s.displayName.split(' (')[0], kind = (/\((.*)\)/.exec(s.displayName) || [])[1] || '';
      var bx = top ? -20 : (left ? 4 : -112);
      g.setAttribute('data-fx', bx + 56); g.setAttribute('data-fy', -34);
      g.appendChild(svgEl('rect', { x: bx, y: -26, width: 112, height: 52, rx: 9, class: 'card-box' }));
      var t1 = svgEl('text', { x: bx + 56, y: -3, 'text-anchor': 'middle', class: 'name' }); t1.textContent = short; g.appendChild(t1);
      var t2 = svgEl('text', { x: bx + 56, y: 16, 'text-anchor': 'middle', class: 'tag' }); t2.textContent = kind; g.appendChild(t2);
      if (s.configured) g.appendChild(svgEl('g', { transform: 'translate(' + (bx + 112 - 12) + ' -30)' }, '<circle r="13" class="check-ring"/><path class="check-tick" d="M-6 0 L-2 5 L7 -6"/>'));
      nodes.appendChild(outer);
    });
    svg.appendChild(nodes);
    var hub = svgEl('g', { transform: 'translate(' + cx + ' ' + cy + ')' }, '<text y="76" text-anchor="middle" class="hub-title">Claude</text><rect x="-95" y="86" width="190" height="30" rx="9" class="tag-box"/><text y="107" text-anchor="middle" class="tag">Natural language control</text>');
    hub.insertBefore(svgEl('g', { class: 'brain', 'data-fx': 0, 'data-fy': -52 }, CLAUDE_MARK), hub.firstChild);
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
    stopLive();
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

  /** The hub sketch with a live indicator; tool calls animate on it (see animateHub). */
  function liveHub(d) {
    var svg = phone.matches ? hubSketchPhone(d.services) : hubSketch(d.services);
    setTimeout(function () { paintHub(svg); }, 0);
    return el('div', { class: 'panel hub' }, [svg, livePill()]);
  }

  function viewServices(d, redraw) {
    var summary = el('p', { class: 'muted', text: d.configuredSummary.length ? 'Enabled: ' + d.configuredSummary.join(', ') : 'No services enabled yet.' });
    if (d.me.role !== 'admin') {
      return [el('section', null, [el('h2', { text: 'Services' }), liveHub(d), el('div', { class: 'panel' }, [
        el('div', { class: 'pills' }, d.services.map(function (s) { return el('span', { class: 'pill' + (s.configured ? ' ok' : ''), text: s.displayName }); })),
        el('p', { class: 'note', text: 'Only admins can change service settings.' })
      ])]), statusBoard(d)];
    }
    var grid = el('div', { class: 'grid' }, d.services.map(function (s) {
      return serviceCard(s, function (r) { d.services = r.services; d.configuredSummary = r.configuredSummary; redraw(); });
    }));
    return [el('section', null, [el('h2', { text: 'Services' }), liveHub(d), summary]), statusBoard(d), el('section', null, [el('h2', { text: 'Connections' }), grid])];
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
      d.oauth && d.oauth.enabled ? [
        el('h3', { text: 'Claude and ChatGPT connectors (sign-in)' }),
        el('p', { class: 'muted', text: 'Add a custom connector with this URL and leave the OAuth client fields empty. You will be sent back here to sign in and approve - no token needed. Access can be revoked under "Access tokens".' }),
        el('pre', { text: endpoint })
      ] : el('p', { class: 'note', text: 'Claude and ChatGPT "custom connectors" are called from the vendors’ clouds. Sign-in for them needs a publicly reachable HTTPS address with a publicly trusted certificate (TLS_MODE=acme, TLS_MODE=file or a reverse proxy)' + (d.oauth && d.oauth.reason ? ' - currently off: ' + d.oauth.reason + '.' : '.') + ' Use the local configurations above otherwise.' })
    ].reduce(function (a, b) { return a.concat(b); }, []))]);
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
    return el('section', null, [el('h2', { text: isAdmin ? 'Access tokens' : 'My access tokens' }), el('div', { class: 'panel' }, [
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
    } else if (t.mode === 'acme' && t.acme) {
      var a = t.acme;
      var ca = a.staging ? 'Let’s Encrypt (staging - not trusted, for testing only)' : a.directoryUrl.indexOf('letsencrypt.org') >= 0 ? 'Let’s Encrypt' : a.directoryUrl;
      var how = a.challenge === 'http-01' ? 'HTTP-01 (port ' + a.httpPort + ' must be reachable from the internet)' : 'DNS-01 via ' + a.dnsProvider;
      var status = { valid: 'Certificate issued - renewed automatically', issuing: 'Requesting a certificate…', pending: 'Waiting for the first certificate (a temporary self-signed certificate is served until then)', 'waiting-dns': 'Waiting for a DNS record (see below)', error: 'Last request failed' }[a.status] || a.status;
      items.push(
        el('p', { text: 'Publicly trusted certificate from ' + ca + ', obtained and renewed automatically. No root certificate needs to be installed on your devices.' }),
        el('div', { class: 'table-wrap' }, [el('table', null, [el('tbody', null, [
          el('tr', null, [el('th', { text: 'Status' }), el('td', { text: status })]),
          el('tr', null, [el('th', { text: 'Names' }), el('td', { text: a.domains.join(', ') })]),
          el('tr', null, [el('th', { text: 'Validation' }), el('td', { text: how })]),
          a.nextAttempt && a.status !== 'valid' ? el('tr', null, [el('th', { text: 'Next attempt' }), el('td', { text: fmtDate(a.nextAttempt) })]) : null
        ])])])
      );
      if (a.pendingCnames && a.pendingCnames.length) {
        items.push(
          el('h3', { text: 'One-time DNS setup' }),
          el('p', { text: 'Create these CNAME records at your DNS provider. They let the acme-dns server answer the Let’s Encrypt check for you - your DNS provider’s credentials stay with you. The server checks every two minutes and continues on its own.' }),
          el('pre', { text: a.pendingCnames.map(function (p) { return p.name + '.  CNAME  ' + p.target + '.'; }).join('\n') })
        );
      }
    } else {
      items.push(el('p', { text: 'TLS is terminated by a reverse proxy (TLS_MODE=off).' }));
    }
    if (t.leaf) {
      items.push(el('h3', { text: 'Server certificate' }), el('div', { class: 'table-wrap' }, [el('table', null, [el('tbody', null, [
        el('tr', null, [el('th', { text: 'Names' }), el('td', { text: t.leaf.sans.join(', ') })]),
        el('tr', null, [el('th', { text: 'Valid until' }), el('td', { text: fmtDate(t.leaf.notAfter) + (t.mode === 'internal' || t.mode === 'acme' ? ' (renewed automatically)' : '') })]),
        el('tr', null, [el('th', { text: 'Issuer' }), el('td', { text: t.leaf.issuer })])
      ])])]));
    }
    if (t.lastError) items.push(el('div', { class: 'msg err', text: t.lastError }));
    if (d.me.role === 'admin') items.push(el('p', { class: 'note' }, ['Change the certificate mode (built-in CA, Let’s Encrypt, own files, reverse proxy) under ', el('button', { class: 'link', text: 'Settings', onclick: function () { currentTab = 'settings'; if (redrawNow) redrawNow(); } }), '.']));
    return el('section', null, [el('h2', { text: 'Certificates' }), el('div', { class: 'panel' }, items)]);
  }

  // ---------- Settings (admin) ----------

  var settingsDraft = null; // unsaved form values, kept across redraws: key -> string | null (null = reset)

  function viewSettings(d, redraw) {
    var S = d.settings;
    if (!S) return el('section', null, [el('h2', { text: 'Settings' }), el('div', { class: 'panel' }, [el('p', { text: 'Only admins can change settings.' })])]);
    if (!settingsDraft) settingsDraft = {};
    var defs = S.defs;
    var byKey = {};
    defs.forEach(function (def) { byKey[def.key] = def; });

    function current(key) {
      var v = S.values[key];
      if (v.source === 'env') return v.value;
      if (Object.prototype.hasOwnProperty.call(settingsDraft, key)) {
        var dv = settingsDraft[key];
        return dv === null ? (byKey[key].default || '') : dv;
      }
      return v.value;
    }
    function visible(def) {
      if (!def.showIf) return true;
      return Object.keys(def.showIf).every(function (k) {
        var cur = current(k);
        if (k === 'ACME_CHALLENGE' && !Object.prototype.hasOwnProperty.call(settingsDraft, k) && S.values[k].source === 'default') cur = S.values[k].value;
        return def.showIf[k].indexOf(cur) >= 0;
      });
    }
    function payload() {
      var values = {};
      defs.forEach(function (def) {
        if (S.values[def.key].source === 'env') return;
        if (!Object.prototype.hasOwnProperty.call(settingsDraft, def.key)) return;
        values[def.key] = settingsDraft[def.key];
      });
      return { values: values };
    }
    var dirty = Object.keys(settingsDraft).length > 0;

    function field(def) {
      var v = S.values[def.key];
      var locked = v.source === 'env';
      var draftHas = Object.prototype.hasOwnProperty.call(settingsDraft, def.key);
      var srcText = locked ? 'from ' + v.envKey : (draftHas ? 'changed' : (v.source === 'file' ? 'saved here' : 'default'));
      var src = el('span', { class: 'pill src' + (draftHas ? ' ok' : ''), text: srcText });
      function set(val, rerender) {
        settingsDraft[def.key] = val;
        if (rerender) redraw();
        else { src.textContent = 'changed'; src.className = 'pill src ok'; saveBtn.disabled = false; }
      }
      var input;
      if (def.type === 'bool') {
        var box = el('input', { type: 'checkbox', disabled: locked, onchange: function () { set(box.checked ? 'true' : 'false', true); } });
        box.checked = current(def.key) === 'true';
        input = el('label', { class: 'check' }, [box, el('span', null, [def.label, ' ', src])]);
      } else if (def.type === 'select') {
        var sel = el('select', { disabled: locked, onchange: function () { set(sel.value, true); } },
          (def.default === '' ? [el('option', { value: '', text: '- choose -' })] : []).concat(def.options.map(function (o) { return el('option', { value: o.value, text: o.label }); })));
        sel.value = current(def.key);
        input = [el('label', null, [def.label, ' ', src]), sel];
      } else {
        var type = { secret: 'password', number: 'number', url: 'url', email: 'email' }[def.type] || 'text';
        var ph = def.placeholder || '';
        if (def.type === 'secret' && v.hasValue) ph = 'Saved' + (v.hint ? ' (ends with ' + v.hint + ')' : '') + ' - leave empty to keep';
        if (def.key === 'ACME_HTTP_PORT' && !ph) ph = S.values[def.key].value;
        var inp = el('input', { type: type, disabled: locked, placeholder: ph, autocomplete: def.type === 'secret' ? 'new-password' : 'off', min: def.min, max: def.max,
          oninput: function () { set(inp.value, false); } });
        var cur = draftHas ? settingsDraft[def.key] : (def.type === 'secret' ? '' : v.value);
        if (def.key === 'ACME_HTTP_PORT' && v.source === 'default' && !draftHas) cur = '';
        inp.value = cur === null ? '' : cur;
        input = [el('label', null, [def.label, ' ', src]), inp];
      }
      var reset = (!locked && (v.source === 'file' || draftHas)) ? el('button', { class: 'link', type: 'button', text: draftHas ? 'Undo' : 'Reset to default', onclick: function () {
        if (draftHas) delete settingsDraft[def.key]; else settingsDraft[def.key] = null;
        redraw();
      } }) : null;
      return el('div', { class: 'setting' }, [].concat(input, [
        def.help ? el('div', { class: 'help', text: def.help }) : null,
        locked ? el('div', { class: 'note', text: 'Set by the environment variable ' + v.envKey + ' - remove it from your compose file / environment to manage it here.' }) : null,
        reset
      ]));
    }

    function group(title, intro, keys) {
      var shown = defs.filter(function (def) { return def.group === keys && visible(def); });
      if (!shown.length) return null;
      var basic = shown.filter(function (def) { return !def.advanced; }).map(field);
      var adv = shown.filter(function (def) { return def.advanced; });
      var advOpen = adv.some(function (def) { return S.values[def.key].source !== 'default' || Object.prototype.hasOwnProperty.call(settingsDraft, def.key); });
      var details = adv.length ? el('details', { open: advOpen }, [el('summary', { text: 'Advanced' })].concat(adv.map(field))) : null;
      return el('div', { class: 'panel' }, [el('h3', { text: title }), intro ? el('p', { class: 'muted', text: intro }) : null].concat(basic, [details]));
    }

    var msg = el('div', { class: 'msg' });
    var logBox = el('pre', { class: 'testlog hidden' });
    var testBtn = el('button', { type: 'button', text: 'Test these settings', onclick: function () {
      testBtn.disabled = true;
      logBox.classList.remove('hidden');
      logBox.textContent = 'Starting…';
      showMsg(msg, 'warn', 'Testing - for Let’s Encrypt this requests a real test certificate and can take a few minutes…');
      api('POST', '/settings/test', payload()).then(function (job) {
        function poll() {
          api('GET', '/settings/test/' + job.id).then(function (j) {
            logBox.textContent = j.log.join('\n') || '…';
            logBox.scrollTop = logBox.scrollHeight;
            if (j.status === 'running') { setTimeout(poll, 1000); return; }
            testBtn.disabled = false;
            showMsg(msg, j.status === 'ok' ? 'ok' : 'err', (j.status === 'ok' ? '' : 'Test failed: ') + (j.message || ''));
          }, function (e) { testBtn.disabled = false; showMsg(msg, 'err', e.message); });
        }
        poll();
      }, function (e) { testBtn.disabled = false; logBox.classList.add('hidden'); showMsg(msg, 'err', e.message); });
    } });
    var saveBtn = el('button', { class: 'primary', type: 'button', text: 'Save & apply', disabled: !dirty, onclick: function () {
      var fromMode = S.values.TLS_MODE.value, toMode = current('TLS_MODE');
      if (fromMode !== toMode) {
        var warn = {
          off: 'The server will switch to PLAIN HTTP on port ' + S.listenPort + '. Only do this behind a reverse proxy that terminates HTTPS for ' + d.publicUrl + ' - otherwise this page will stop working (set TLS_MODE in the environment to recover).',
          internal: 'The server will use its built-in CA. Devices must trust its root certificate (Certificates tab) - browsers that remember HSTS for this site refuse the page until it is installed.',
          acme: 'The current certificate stays in use until the CA has issued the new one (see the Certificates tab for progress). Tip: use "Test these settings" first.',
          file: 'The server will use the certificate files. Make sure they are valid (use "Test these settings").'
        }[toMode];
        if (!confirm('Switch certificate mode from ' + fromMode + ' to ' + toMode + '?\n\n' + warn)) return;
      }
      saveBtn.disabled = true;
      showMsg(msg, 'warn', 'Applying…');
      api('PUT', '/settings', payload()).then(function (r) {
        settingsDraft = null;
        if (r.listenerChange) {
          showMsg(msg, 'ok', 'Applied. The server now switches between HTTPS and HTTP - reloading…');
          setTimeout(function () { location.href = r.reloadUrl || '/admin'; }, 2500);
          return;
        }
        Object.assign(d, r.overview);
        redraw();
        setTimeout(function () { var m = document.getElementById('settings-msg'); if (m) showMsg(m, 'ok', 'Settings saved and applied - no restart needed.'); }, 0);
      }, function (e) { saveBtn.disabled = false; showMsg(msg, 'err', e.message); });
    } });
    msg.id = 'settings-msg';
    var discard = dirty ? el('button', { type: 'button', text: 'Discard changes', onclick: function () { settingsDraft = null; redraw(); } }) : null;

    var startup = el('div', { class: 'panel' }, [
      el('h3', { text: 'Startup settings (environment only)' }),
      el('p', { class: 'muted', text: 'These are read when the server starts. Change them in your compose file / environment and restart. PUBLIC_URL cannot change at runtime: passkeys are bound to its host name.' }),
      el('div', { class: 'table-wrap' }, [el('table', null, [el('tbody', null, S.startup.map(function (x) {
        return el('tr', null, [el('th', { text: x.key }), el('td', null, [el('code', { text: x.value || '(not set)' })])]);
      }))])])
    ]);

    return el('section', null, [
      el('h2', { text: 'Settings' }),
      el('p', { class: 'muted', text: 'Changes are stored in the encrypted config file and applied immediately - no restart. Environment variables always win; those fields are read-only here.' }),
      group('Certificate', null, 'tls'),
      group('Let’s Encrypt / ACME', 'A publicly trusted certificate for a domain you own, renewed automatically. The name must resolve to this server (for a LAN-only server: a local DNS record).', 'acme'),
      group('DNS validation', 'The CA checks a TXT record under _acme-challenge.<name>. Nothing has to be reachable from the internet.', 'dns'),
      group('Access and connectors', null, 'access'),
      el('div', { class: 'panel' }, [
        el('div', { class: 'row' }, [saveBtn, testBtn, discard]),
        msg, logBox
      ]),
      startup
    ]);
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


  // ---------- live activity + status board ----------
  var reduceMotion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;
  var live = { es: null, snap: null, mySnap: null, meId: null, meEl: null, connected: false, boardEl: null, pillEls: [], flows: {}, starts: {}, lastNewId: 0, prevTiles: {}, services: [] };
  var SERVICE_NAMES = { core: 'Claude tools' };
  var HOUR_MS = 3600000;

  function fmtNum(n) { return Number(n || 0).toLocaleString(); }
  function fmtMs(ms) { return !ms ? '-' : ms < 1000 ? ms + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + ' s'; }
  function ago(iso) {
    if (!iso) return 'never';
    var s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
  }
  function clock(iso) { var t = new Date(iso); return [t.getHours(), t.getMinutes(), t.getSeconds()].map(function (n) { return n < 10 ? '0' + n : String(n); }).join(':'); }
  function svcName(id) { return SERVICE_NAMES[id] || id; }

  function startLive() {
    if (live.es || !window.EventSource) return;
    var es = new EventSource('/admin/api/activity');
    live.es = es;
    es.onopen = function () { live.connected = true; live.flows = {}; live.starts = {}; refreshStats(); paintPills(); };
    es.onerror = function () { live.connected = false; paintPills(); };
    es.addEventListener('call', function (m) {
      var e;
      try { e = JSON.parse(m.data); } catch (x) { return; }
      onLiveCall(e);
    });
  }
  function stopLive() {
    if (live.es) live.es.close();
    live.es = null; live.connected = false; live.snap = null; live.mySnap = null;
  }
  function refreshStats() {
    if (live.meEl && document.body.contains(live.meEl)) refreshMine();
    return api('GET', '/stats').then(function (r) { live.snap = r; updateBoard(); }, function () {});
  }

  function inFlight() { return Object.keys(live.flows).reduce(function (n, k) { return n + live.flows[k]; }, 0); }
  function paintPills() {
    live.pillEls = live.pillEls.filter(function (p) { return document.body.contains(p); });
    var busy = inFlight();
    live.pillEls.forEach(function (p) {
      p.className = 'live-pill' + (p.getAttribute('data-static') ? ' static' : '') + (live.connected ? ' on' : '') + (busy ? ' busy' : '');
      p.lastChild.textContent = !live.connected ? 'offline' : busy ? busy + (busy === 1 ? ' call' : ' calls') + ' running' : 'live';
    });
  }
  function livePill() {
    var p = el('div', { class: 'live-pill', 'aria-live': 'polite' }, [el('span', { class: 'dot' }), el('span', { text: 'live' })]);
    live.pillEls.push(p);
    setTimeout(paintPills, 0);
    return p;
  }

  /** Animate one call on a hub sketch: ink flows along the arrow, then the service card hops (or shakes). */
  function animateHub(e, svg) {
    svg = svg || document.querySelector('.hub:not(.demo) svg');
    var key = e.service;
    if (e.phase === 'start') {
      live.flows[key] = (live.flows[key] || 0) + 1;
      live.starts[e.id] = Date.now();
      paintHub(svg);
      return;
    }
    var shown = live.starts[e.id];
    delete live.starts[e.id];
    // keep the flow visible for a moment even for instant calls
    var wait = shown ? Math.max(0, 700 - (Date.now() - shown)) : 0;
    setTimeout(function () {
      if (shown) live.flows[key] = Math.max(0, (live.flows[key] || 0) - 1);
      if (!live.flows[key]) delete live.flows[key];
      paintHub(svg);
      if (!svg || !document.body.contains(svg)) return;
      var node = svg.querySelector('.node[data-svc="' + key + '"]') || svg.querySelector('.brain');
      if (!node) return;
      node.classList.remove('pop', 'shake');
      void node.getBoundingClientRect();
      node.classList.add(e.ok ? 'pop' : 'shake');
      var t = svgEl('text', { x: node.getAttribute('data-fx') || 0, y: node.getAttribute('data-fy') || 0, class: 'float ' + (e.ok ? 'ok' : 'err') });
      t.textContent = e.ok ? '+1' : '!';
      node.appendChild(t);
      setTimeout(function () { t.remove(); node.classList.remove('pop', 'shake'); }, 1300);
    }, wait);
  }
  function paintHub(svg) {
    paintPills();
    if (!svg || !document.body.contains(svg)) return;
    var any = inFlight() > 0;
    Array.prototype.forEach.call(svg.querySelectorAll('.arrow'), function (a) {
      var k = a.getAttribute('data-svc');
      a.classList.toggle('flow', k === 'all' ? any : Boolean(live.flows[k]));
    });
    var brain = svg.querySelector('.brain');
    if (brain) brain.classList.toggle('think', any);
  }

  function onLiveCall(e) {
    animateHub(e);
    if (e.phase !== 'end') return;
    live.lastNewId = e.id;
    if (live.snap) {
      applyCall(live.snap, e);
      if (live.isAdmin && e.caller && e.callerId) {
        var c = live.snap.callers.filter(function (x) { return x.id === e.callerId; })[0];
        if (!c) { c = { id: e.callerId, name: e.caller, calls: 0, errors: 0, avgMs: 0 }; live.snap.callers.push(c); }
        bumpCounter(c, e);
        live.snap.callers.sort(function (a, b) { return b.calls - a.calls; });
      }
      updateBoard();
    }
    if (live.mySnap && e.callerId && e.callerId === live.meId) {
      var m = live.mySnap;
      if (!m.totals.today) m.totals.activeDays++;
      applyCall(m, e);
      var key = e.client || 'unknown client';
      var app = m.clients.filter(function (x) { return x.name === key; })[0];
      if (!app) { app = { name: key, calls: 0, errors: 0, avgMs: 0 }; m.clients.push(app); }
      bumpCounter(app, e);
      m.clients.sort(function (a, b) { return b.calls - a.calls; });
      rollDays(m);
      m.daily[m.daily.length - 1].calls++;
      updateMine();
    }
    // only the render right after the event highlights the new feed row
    setTimeout(function () { if (live.lastNewId === e.id) live.lastNewId = 0; }, 0);
  }
  function bumpCounter(c, e) {
    c.calls++;
    if (!e.ok) c.errors++;
    c.avgMs = Math.round(((c.avgMs || 0) * (c.calls - 1) + (e.ms || 0)) / c.calls);
    c.lastAt = e.at;
    return c;
  }
  /** Apply one finished call to a snapshot (global or personal - both have the same core shape). */
  function applyCall(s, e) {
    rollHours(s);
    bumpCounter(s.totals, e);
    s.totals.today++;
    s.services[e.service] = bumpCounter(s.services[e.service] || { calls: 0, errors: 0, avgMs: 0 }, e);
    var tool = s.tools.filter(function (t) { return t.tool === e.tool; })[0];
    if (!tool) { tool = { tool: e.tool, service: e.service, calls: 0, errors: 0, avgMs: 0 }; s.tools.push(tool); }
    bumpCounter(tool, e);
    s.tools.sort(function (a, b) { return b.calls - a.calls; });
    s.tools = s.tools.slice(0, 8);
    s.hourly[s.hourly.length - 1]++;
    s.recent.unshift(e);
    s.recent = s.recent.slice(0, 40);
  }
  function localDay(t) { var d = new Date(t); return d.getFullYear() + '-' + (d.getMonth() < 9 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate(); }
  /** Start a new day column (and reset "today") after midnight. */
  function rollDays(m) {
    var today = localDay(Date.now());
    if (m.daily[m.daily.length - 1].day === today) return;
    m.daily.shift();
    m.daily.push({ day: today, calls: 0 });
    m.totals.today = 0;
  }
  /** Move the 24-hour window forward when an hour has passed since the snapshot. */
  function rollHours(s) {
    var end = Date.parse(s.hourlyEndsAt), now = Date.now(), n = 0;
    while (now >= end && n < 24) { s.hourly.shift(); s.hourly.push(0); end += HOUR_MS; n++; }
    if (now >= end) end = (Math.floor(now / HOUR_MS) + 1) * HOUR_MS;
    s.hourlyEndsAt = new Date(end).toISOString();
  }
  setInterval(function () {
    if (live.snap) { rollHours(live.snap); updateBoard(); }
    if (live.mySnap) { rollHours(live.mySnap); rollDays(live.mySnap); updateMine(); }
  }, 60000);

  function statusBoard(d) {
    live.services = d.services;
    live.isAdmin = d.me.role === 'admin';
    live.meId = d.me.id;
    var section = el('section', { class: 'board', 'aria-label': 'Status board' });
    live.boardEl = section;
    if (live.snap) updateBoard(); else section.appendChild(el('p', { class: 'muted', text: 'Loading statistics…' }));
    if (!live.snap && !live.es) refreshStats();
    return section;
  }

  function tile(key, value, label, extra, drawing) {
    var num = el('span', { class: 'num', text: value });
    if (live.prevTiles[key] !== undefined && live.prevTiles[key] !== value && !reduceMotion) num.classList.add('bump');
    live.prevTiles[key] = value;
    return el('div', { class: 'panel tile' }, [drawing ? svgEl('svg', { viewBox: '0 0 34 24', 'aria-hidden': 'true' }, drawing) : null, num, el('div', { class: 'lbl', text: label }), extra ? el('div', { class: 'tiny', text: extra }) : null]);
  }

  function updateBoard() {
    var s = live.snap, root = live.boardEl;
    if (!s || !root) return;
    var t = s.totals;
    var rate = t.calls ? Math.round(1000 * (t.calls - t.errors) / t.calls) / 10 : null;
    var tiles = el('div', { class: 'tiles' }, [
      tile('today', fmtNum(t.today), 'Calls today', s.busiestDay && s.busiestDay.calls > t.today ? 'record: ' + fmtNum(s.busiestDay.calls) : (t.today ? 'a record day!' : 'quiet so far'),
        '<path class="thin" d="M4 20 L12 12 L18 16 L30 4 M24 4 H30 V10"/>'),
      tile('all', fmtNum(t.calls), 'All-time calls', 'since ' + new Date(s.since).toLocaleDateString(),
        '<path class="thin" d="M5 4 V20 M10 4 V20 M15 4 V20 M20 4 V20 M2 16 L24 8"/>'),
      tile('rate', rate === null ? '-' : rate + '%', 'Success rate', t.errors ? fmtNum(t.errors) + ' hiccup' + (t.errors === 1 ? '' : 's') : 'no hiccups',
        '<path class="check-tick" d="M8 12 L14 18 L26 5"/>'),
      tile('avg', fmtMs(t.avgMs), 'Avg response', 'per tool call',
        '<circle cx="17" cy="13" r="9" class="thin"/><path class="thin" d="M17 8 V13 L21 15 M14 2 H20"/>')
    ]);
    var head = el('div', { class: 'board-head' }, [el('h2', { text: 'Status board' }), el('span', { class: 'note', text: 'Counting MCP tool calls since ' + fmtDate(s.since) })]);
    var grid1 = el('div', { class: 'board-grid' }, [perServicePanel(s), hourlyPanel(s)]);
    var grid2 = el('div', { class: 'board-grid' }, [feedPanel(s), toolsPanel(s)].concat(live.isAdmin ? [callersPanel(s)] : []));
    root.replaceChildren(head, tiles, grid1, grid2);
  }

  function emptyNote(text) {
    return el('div', { class: 'empty' }, [svgEl('svg', { viewBox: '-80 -56 160 112', 'aria-hidden': 'true' }, '<g transform="scale(1.1)">' + CLAUDE_MARK + '</g>'), el('div', { text: text })]);
  }

  function perServicePanel(s, title) {
    var ids = live.services.filter(function (x) { return x.configured || s.services[x.id]; }).map(function (x) { SERVICE_NAMES[x.id] = x.displayName; return x.id; });
    ids.push('core');
    SERVICE_NAMES.core = 'Claude tools (TRaSH, search, status)';
    var max = ids.reduce(function (m, id) { return Math.max(m, (s.services[id] || {}).calls || 0); }, 0);
    ids.sort(function (a, b) { return ((s.services[b] || {}).calls || 0) - ((s.services[a] || {}).calls || 0); });
    var rows = ids.map(function (id) {
      var c = s.services[id] || { calls: 0, errors: 0, avgMs: 0 };
      var fill = el('div', { class: 'fill' });
      fill.style.width = (max ? Math.max(1.5, 100 * c.calls / max) : 0) + '%';
      var short = svcName(id).split(' (')[0];
      return el('li', { title: svcName(id) + ': ' + fmtNum(c.calls) + ' calls, ' + fmtNum(c.errors) + ' failed, avg ' + fmtMs(c.avgMs) + ', last ' + ago(c.lastAt) }, [
        serviceIcon(id, c.calls > 0 || id === 'core'),
        el('div', { class: 'bar-label' }, [el('strong', { text: short }), el('span', { class: 'muted', text: fmtNum(c.calls) + (c.errors ? ' · ' + fmtNum(c.errors) + ' failed' : '') + (c.calls ? ' · ' + fmtMs(c.avgMs) : '') })]),
        el('div', { class: 'track', role: 'img', 'aria-label': short + ' ' + c.calls + ' calls' }, [fill])
      ]);
    });
    return el('div', { class: 'panel' }, [el('h3', { text: title || 'Calls per connection' }), el('ul', { class: 'bars' }, rows)]);
  }

  /** Hand-drawn column chart. opts: label(i) -> axis label or '', tip(i) -> hover text, aria. The last column is highlighted. */
  function columnChart(values, opts) {
    var W = 480, H = 160, L = 30, R = 470, T = 18, B = 124, n = values.length, slot = (R - L) / n;
    var max = Math.max(4, Math.max.apply(null, values));
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.aria });
    svg.appendChild(svgEl('path', { class: 'grid', d: 'M' + L + ' ' + T + ' H' + R }));
    var mx = svgEl('text', { x: L - 6, y: T + 4, 'text-anchor': 'end' }); mx.textContent = String(max); svg.appendChild(mx);
    values.forEach(function (v, i) {
      var x = L + i * slot + Math.min(2, slot * 0.15), w = slot - 2 * Math.min(2, slot * 0.15);
      var h = v ? Math.max(4, (B - T) * v / max) : 0;
      var g = svgEl('g');
      var tip = svgEl('title'); tip.textContent = opts.tip(i); g.appendChild(tip);
      g.appendChild(svgEl('rect', { class: 'bar-hit', x: L + i * slot, y: T, width: slot, height: B - T }));
      if (h) {
        // a slightly wobbly, hand-drawn column anchored on the baseline
        var j = (i % 3) - 1, r = Math.min(3, w / 3);
        g.appendChild(svgEl('path', { class: 'bar' + (i === n - 1 ? ' now' : ''), d: 'M' + x + ' ' + B + ' L' + (x + j * 0.6) + ' ' + (B - h + r) + ' Q' + x + ' ' + (B - h) + ' ' + (x + r) + ' ' + (B - h + j * 0.8) + ' L' + (x + w - r) + ' ' + (B - h - j * 0.8) + ' Q' + (x + w) + ' ' + (B - h) + ' ' + (x + w - j * 0.6) + ' ' + (B - h + r) + ' L' + (x + w) + ' ' + B + ' Z' }));
        g.appendChild(svgEl('path', { d: 'M' + x + ' ' + B + ' V' + (B - h + r) + ' H' + (x + w) + ' V' + B + ' Z', fill: 'url(#hatch)', 'pointer-events': 'none' }));
      }
      svg.appendChild(g);
      var label = opts.label(i);
      if (label) {
        var lab = svgEl('text', { x: x + w / 2, y: B + 20, 'text-anchor': 'middle' });
        lab.textContent = label;
        svg.appendChild(lab);
      }
    });
    svg.appendChild(svgEl('path', { class: 'axis', d: 'M' + (L - 4) + ' ' + B + ' Q' + ((L + R) / 2) + ' ' + (B + 2) + ' ' + (R + 2) + ' ' + B }));
    return svg;
  }

  function hourlyPanel(s) {
    var n = s.hourly.length, end = Date.parse(s.hourlyEndsAt);
    function from(i) { return new Date(end - (n - i) * HOUR_MS); }
    var total = s.hourly.reduce(function (a, b) { return a + b; }, 0);
    var peak = s.hourly.indexOf(Math.max.apply(null, s.hourly));
    var svg = columnChart(s.hourly, {
      aria: 'Tool calls per hour, last 24 hours: ' + total + ' in total',
      label: function (i) { return i === n - 1 ? 'now' : i % 6 === 0 ? from(i).getHours() + ':00' : ''; },
      tip: function (i) { var h = from(i).getHours(); return h + ':00 - ' + ((h + 1) % 24) + ':00: ' + s.hourly[i] + (s.hourly[i] === 1 ? ' call' : ' calls'); }
    });
    return el('div', { class: 'panel chart' }, [
      el('h3', { text: 'Last 24 hours' }), svg,
      el('p', { class: 'note', text: total ? fmtNum(total) + ' calls · busiest hour ' + from(peak).getHours() + ':00 (' + s.hourly[peak] + ')' : 'No calls in the last 24 hours.' })
    ]);
  }

  function dailyPanel(m) {
    var vals = m.daily.map(function (x) { return x.calls; }), n = vals.length;
    function date(i) { var p = m.daily[i].day.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
    var total = vals.reduce(function (a, b) { return a + b; }, 0);
    var best = vals.indexOf(Math.max.apply(null, vals));
    var streak = 0;
    for (var i = n - 1; i >= 0 && vals[i] > 0; i--) streak++;
    if (!streak && n > 1 && vals[n - 1] === 0) { for (i = n - 2; i >= 0 && vals[i] > 0; i--) streak++; }
    var svg = columnChart(vals, {
      aria: 'Your tool calls per day, last ' + n + ' days: ' + total + ' in total',
      label: function (i) { return i === n - 1 ? 'today' : (n - 1 - i) % 7 === 0 ? date(i).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''; },
      tip: function (i) { return date(i).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ': ' + vals[i] + (vals[i] === 1 ? ' call' : ' calls'); }
    });
    return el('div', { class: 'panel chart' }, [
      el('h3', { text: 'Last ' + n + ' days' }), svg,
      el('p', { class: 'note', text: total ? fmtNum(total) + ' calls · best day ' + date(best).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' (' + vals[best] + ')' + (streak > 1 ? ' · ' + streak + '-day streak' : '') : 'Nothing yet this month.' })
    ]);
  }

  function feedPanel(s, title, mine) {
    var rows = s.recent.slice(0, 25).map(function (e) {
      return el('li', { class: e.id === live.lastNewId && !reduceMotion ? 'new' : '' }, [
        el('span', { class: 't', text: clock(e.at) }),
        serviceIcon(e.service, true),
        el('span', { class: 'tool', text: e.tool, title: e.tool }),
        el('span', { class: 'mark ' + (e.ok ? 'ok' : 'err'), text: e.ok ? '✓ ok' : '✗ failed' }),
        el('span', { class: 'meta', text: [mine ? e.client : e.caller, fmtMs(e.ms)].filter(Boolean).join(' · ') })
      ]);
    });
    var pill = livePill();
    pill.setAttribute('data-static', '1');
    pill.classList.add('static');
    return el('div', { class: 'panel' }, [
      el('div', { class: 'card-head' }, [el('h3', { text: title || 'Live feed' }), pill]),
      rows.length ? el('ul', { class: 'feed', 'aria-live': 'polite' }, rows) : emptyNote(mine ? 'No calls from your apps since the server started.' : 'Waiting for the first call - ask Claude about your library!')
    ]);
  }

  function toolsPanel(s, title) {
    var max = s.tools.length ? s.tools[0].calls : 0;
    var rows = s.tools.map(function (t) {
      var fill = el('div', { class: 'fill' + (t.errors > t.calls / 2 ? ' err' : '') });
      fill.style.width = (max ? 100 * t.calls / max : 0) + '%';
      return el('li', { title: t.tool + ': ' + t.calls + ' calls, ' + t.errors + ' failed, avg ' + fmtMs(t.avgMs) }, [
        el('code', { text: t.tool }), el('span', { class: 'muted', text: fmtNum(t.calls) }),
        el('div', { class: 'track small' }, [fill])
      ]);
    });
    return el('div', { class: 'panel' }, [el('h3', { text: title || 'Favourite tools' }), rows.length ? el('ol', { class: 'toplist' }, rows) : emptyNote('No favourites yet.')]);
  }

  function callersPanel(s) {
    var rows = s.callers.map(function (c) {
      return el('tr', null, [el('td', { text: c.name }), el('td', { text: fmtNum(c.calls) }), el('td', { text: c.calls ? Math.round(100 * (c.calls - c.errors) / c.calls) + '%' : '-' }), el('td', { text: ago(c.lastAt) })]);
    });
    var table = el('table', null, [el('thead', null, [el('tr', null, [el('th', { text: 'User' }), el('th', { text: 'Calls' }), el('th', { text: 'Success' }), el('th', { text: 'Last call' })])]), el('tbody', null, rows)]);
    labelTables(el('div', null, [table]));
    return el('div', { class: 'panel' }, [el('h3', { text: 'Who is asking' }), rows.length ? el('div', { class: 'table-wrap' }, [table]) : emptyNote('Nobody has called yet.')]);
  }


  // ---------- my activity (personal statistics) ----------
  function refreshMine() {
    return api('GET', '/me/stats').then(function (r) { live.mySnap = r; updateMine(); }, function () {});
  }

  function viewMine(d) {
    live.meId = d.me.id;
    live.services = d.services;
    var section = el('section', { class: 'board', 'aria-label': 'My activity' });
    live.meEl = section;
    if (live.mySnap) updateMine(); else section.appendChild(el('p', { class: 'muted', text: 'Loading your statistics…' }));
    refreshMine();
    return section;
  }

  function updateMine() {
    var m = live.mySnap, root = live.meEl;
    if (!m || !root) return;
    var t = m.totals, lg = m.logins;
    var rate = t.calls ? Math.round(1000 * (t.calls - t.errors) / t.calls) / 10 : null;
    var tiles = el('div', { class: 'tiles' }, [
      tile('me-today', fmtNum(t.today), 'My calls today', t.today ? 'nice work' : 'nothing yet today',
        '<path class="thin" d="M4 20 L12 12 L18 16 L30 4 M24 4 H30 V10"/>'),
      tile('me-all', fmtNum(t.calls), 'My calls', t.activeDays ? 'on ' + t.activeDays + ' active day' + (t.activeDays === 1 ? '' : 's') : 'none yet',
        '<path class="thin" d="M5 4 V20 M10 4 V20 M15 4 V20 M20 4 V20 M2 16 L24 8"/>'),
      tile('me-rate', rate === null ? '-' : rate + '%', 'Success rate', t.calls ? 'avg ' + fmtMs(t.avgMs) : 'no calls yet',
        '<path class="check-tick" d="M8 12 L14 18 L26 5"/>'),
      tile('me-logins', fmtNum(lg.count), 'Sign-ins', lg.lastAt ? 'last ' + ago(lg.lastAt) : 'none recorded',
        '<rect x="9" y="11" width="16" height="11" rx="3" class="thin"/><path class="thin" d="M12 11 V7 A5 5 0 0 1 22 7 V11"/>')
    ]);
    var head = el('div', { class: 'board-head' }, [
      el('h2', { text: 'My activity' }),
      el('span', { class: 'note', text: 'Only you (and admins) can see this. Counting since ' + fmtDate(m.since) })
    ]);
    root.replaceChildren(head,
      el('p', { class: 'muted', text: 'Hi ' + m.name + ' - here is what you and your apps have been up to.' }),
      tiles,
      el('div', { class: 'board-grid' }, [perServicePanel(m, 'My calls per connection'), dailyPanel(m)]),
      el('div', { class: 'board-grid' }, [appsPanel(m), toolsPanel(m, 'My favourite tools')]),
      el('div', { class: 'board-grid' }, [feedPanel(m, 'My recent calls', true), signInsPanel(lg)])
    );
    labelTables(root);
  }

  function appsPanel(m) {
    var max = m.clients.length ? m.clients[0].calls : 0;
    var rows = m.clients.map(function (c) {
      var fill = el('div', { class: 'fill' });
      fill.style.width = (max ? 100 * c.calls / max : 0) + '%';
      return el('li', { title: c.name + ': ' + c.calls + ' calls, ' + c.errors + ' failed, avg ' + fmtMs(c.avgMs) }, [
        el('div', { class: 'app-name' }, [el('strong', { text: c.name }), el('span', { class: 'note', text: 'last used ' + ago(c.lastAt) })]),
        el('span', { class: 'muted', text: fmtNum(c.calls) + (c.errors ? ' · ' + fmtNum(c.errors) + ' failed' : '') }),
        el('div', { class: 'track small' }, [fill])
      ]);
    });
    return el('div', { class: 'panel' }, [
      el('h3', { text: 'My apps' }),
      el('p', { class: 'note', text: 'Calls per access token or connected app.' }),
      rows.length ? el('ol', { class: 'toplist apps' }, rows) : emptyNote('No app has used your tokens yet - see "Connect".')
    ]);
  }

  function signInsPanel(lg) {
    var how = { passkey: 'Passkey', password: 'Password', 'new account': 'Account created', 'connected app': 'Approved an app' };
    var rows = lg.recent.map(function (x) {
      return el('tr', null, [el('td', { text: fmtDate(x.at) }), el('td', { text: how[x.method] || x.method }), el('td', { text: x.device })]);
    });
    var methods = Object.keys(lg.methods).map(function (k) { return el('span', { class: 'pill', text: (how[k] || k) + ': ' + lg.methods[k] }); });
    return el('div', { class: 'panel' }, [
      el('h3', { text: 'Sign-ins' }),
      methods.length ? el('div', { class: 'pills' }, methods) : null,
      lg.failed ? el('div', { class: 'msg warn', text: lg.failed + ' wrong password' + (lg.failed === 1 ? '' : 's') + ' entered for your account, last ' + ago(lg.lastFailedAt) + '. If that was not you, change your password under "My sign-in".' }) : null,
      rows.length ? el('div', { class: 'table-wrap' }, [el('table', null, [
        el('thead', null, [el('tr', null, [el('th', { text: 'When' }), el('th', { text: 'How' }), el('th', { text: 'Device' })])]),
        el('tbody', null, rows)
      ])]) : emptyNote('No sign-ins recorded yet.'),
      el('p', { class: 'note', text: 'The last 20 sign-ins are kept. Devices are shown as browser and system only.' })
    ]);
  }

  // ---------- brand guide ----------
  var BRAND_COLORS = [
    ['Terracotta', 'accent', '#d06c43', '#e07f55', 'Primary buttons, the C in the logo, arrows'],
    ['Fired clay', 'accent-deep', '#8f4425', '#f2a07b', 'Arrow outlines, links, pressed states'],
    ['Sea glass', 'sea', '#5f9e96', '#78bab1', 'The brain, focus rings, active tab'],
    ['Sea foam', 'sea-pale', '#cfe5df', '#2f5752', 'Hover fills, tags, highlights'],
    ['Apricot', 'gold', '#e3a979', '#c98c5e', 'Tickets, notes, live ink flow'],
    ['Olive', 'olive', '#a3a372', '#b7b783', 'Quiet secondary accents'],
    ['Pewter', 'steel', '#b9b4aa', '#6d685f', 'Screens, reels, neutral fills'],
    ['Ink', 'text', '#3b322a', '#f1e6cf', 'Every outline and all text'],
    ['Paper', 'paper', '#f4ead3', '#29251f', 'Header and card faces'],
    ['Kraft', 'bg', '#e6d6b2', '#1f1b16', 'Page background']
  ];
  var STATUS_COLORS = [['Good', 'ok', '#2f7a3a', '#79c47e'], ['Heads-up', 'warn', '#7a4d00', '#f2c063'], ['Problem', 'err', '#a32a1c', '#ff9a8a']];
  var LOGO_FILE = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-14 0 142 88" width="568" height="352">' +
    '<path d="M44 14 A32 32 0 1 0 44 74" fill="none" stroke="#d06c43" stroke-width="15" stroke-linecap="round"/>' +
    '<path d="M44 6 A40 40 0 1 0 44 82 M44 22 A24 24 0 1 0 44 66" fill="none" stroke="#3b322a" stroke-width="2" stroke-linecap="round" opacity=".7"/>' +
    '<path fill="#5f9e96" stroke="#3b322a" stroke-width="3" stroke-linejoin="round" d="M78 22 C66 18 54 28 56 38 C46 40 46 54 54 58 C48 68 58 78 70 76 C74 84 86 82 88 72 L88 24 Z"/>' +
    '<path fill="#5f9e96" stroke="#3b322a" stroke-width="3" stroke-linejoin="round" d="M92 22 C104 18 116 28 114 38 C124 40 124 54 116 58 C122 68 112 78 100 76 C96 84 86 82 84 72 L84 26 Z"/>' +
    '<path fill="none" stroke="#3b322a" stroke-width="2" stroke-linecap="round" d="M66 34 C60 40 70 44 64 50 M104 34 C110 40 100 44 106 50"/></svg>';
  var NOPE = '<circle cx="15" cy="15" r="12" fill="var(--err-bg)" stroke="var(--err)" stroke-width="2.5"/><path d="M10 10 L20 20 M20 10 L10 20" stroke="var(--err)" stroke-width="3" stroke-linecap="round"/>';

  function logoSvg() {
    var src = document.querySelector('header .brand svg');
    var c = src.cloneNode(true);
    c.setAttribute('class', 'logo');
    return c;
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = el('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }
  function brandSection(id, title, intro, body) {
    return el('section', { id: 'brand-' + id }, [el('h2', { text: title }), el('div', { class: 'panel' }, [intro ? el('p', { class: 'muted', text: intro }) : null].concat(body))]);
  }
  function stage(cls, caption, extra) {
    return el('div', { class: 'stage ' + (cls || '') }, [logoSvg(), el('div', { class: 'cap', text: caption })].concat(extra || []));
  }

  function viewBrand(d) {
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var sections = [];
    var toc = el('nav', { class: 'toc', 'aria-label': 'Brand guide sections' });

    var hero = el('div', { class: 'panel brand-hero' }, [logoSvg(), el('div', null, [
      el('h2', { text: 'MCP-ARR' }),
      el('div', { class: 'tagline', text: 'Media management via AI' }),
      el('p', { class: 'muted', text: 'A sketchbook for your media server: warm paper, felt-tip ink, terracotta and sea glass. Everything looks drawn by hand - friendly, a little wonky, never sloppy.' }),
      el('div', { class: 'row' }, [
        el('button', { class: 'primary', text: 'Download logo (SVG)', onclick: function () { download('mcp-arr-logo.svg', LOGO_FILE, 'image/svg+xml'); } }),
        el('button', { text: 'Copy design tokens', onclick: function (ev) {
          var b = ev.currentTarget;
          navigator.clipboard.writeText(tokensCss()).then(function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy design tokens'; }, 1500); });
        } })
      ])
    ])]);

    sections.push(['logo', brandSection('logo', 'Logo', 'The mark is a terracotta C (for Claude) hugging a two-lobed sea-glass brain: the AI that runs your *arr stack. The thin echo lines around the C are part of the sketch - keep them.', [
      el('div', { class: 'stages' }, [
        stage('theme-light', 'On paper'),
        stage('theme-dark', 'On ink (dark mode)'),
        stage('clear', 'Clear space: one brain-height', [el('div', { class: 'note', text: 'Never smaller than 32 px tall' })])
      ]),
      el('h3', { text: 'Please don’t' }),
      el('div', { class: 'stages' }, [
        stage('dont dont-stretch', 'Stretch or squash it', [svgEl('svg', { class: 'nope', viewBox: '0 0 30 30' }, NOPE)]),
        stage('dont dont-tilt', 'Tilt it', [svgEl('svg', { class: 'nope', viewBox: '0 0 30 30' }, NOPE)]),
        stage('dont dont-recolor', 'Recolour the brain or C', [svgEl('svg', { class: 'nope', viewBox: '0 0 30 30' }, NOPE)]),
        stage('dont dont-busy', 'Put it on busy patterns', [svgEl('svg', { class: 'nope', viewBox: '0 0 30 30' }, NOPE)])
      ])
    ])]);

    var chips = BRAND_COLORS.map(function (c) {
      var a = el('span'), b = el('span');
      a.style.background = c[2]; b.style.background = c[3];
      return el('button', { class: 'chip', type: 'button', title: 'Copy ' + (dark ? c[3] : c[2]), onclick: function (ev) {
        var btn = ev.currentTarget, hex = dark ? c[3] : c[2];
        navigator.clipboard.writeText(hex).then(function () { var s = btn.querySelector('strong'); s.textContent = 'Copied ' + hex; setTimeout(function () { s.textContent = c[0]; }, 1400); });
      } }, [el('div', { class: 'split', 'aria-hidden': 'true' }, [a, b]), el('strong', { text: c[0] }), el('code', { text: c[2] + ' / ' + c[3] }), el('div', { class: 'note', text: '--' + c[1] }), el('div', { class: 'use', text: c[4] })]);
    });
    sections.push(['color', brandSection('color', 'Colour', 'Earthy and warm. Terracotta does the talking, sea glass listens. Each chip shows light mode on the left and dark mode on the right - click one to copy the colour for the current mode.', [
      el('div', { class: 'swatches' }, chips),
      el('h3', { text: 'Status colours' }),
      el('p', { class: 'note', text: 'Reserved for state - never decoration. Always pair them with a word or a mark (✓, !, ✗), never colour alone.' }),
      el('div', { class: 'pills' }, [el('span', { class: 'pill ok', text: '✓ Good  #2f7a3a / #79c47e' }), el('span', { class: 'pill warn', text: '! Heads-up  #7a4d00 / #f2c063' }), el('span', { class: 'pill', text: '✗ Problem  #a32a1c / #ff9a8a' })])
    ])]);

    var hand = getComputedStyle(document.body).getPropertyValue('--hand').trim();
    sections.push(['type', brandSection('type', 'Typography', 'One handwriting family does everything, picked from the fonts already on the device (no web fonts: the UI works offline and under a strict content policy). Monospace is only for things people copy: URLs, tokens, tool names.', [
      el('div', { class: 'type-row' }, [el('div', { class: 'spec', text: 'Display · 40 / bold / +2 tracking' }), el('div', { class: 't-display', text: 'MCP-ARR' })]),
      el('div', { class: 'type-row' }, [el('div', { class: 'spec', text: 'Heading · 22 / bold' }), el('div', { class: 't-h2', text: 'Connect an MCP client' })]),
      el('div', { class: 'type-row' }, [el('div', { class: 'spec', text: 'Subheading · 16 / bold' }), el('div', { class: 't-h3', text: 'Calls per connection' })]),
      el('div', { class: 'type-row' }, [el('div', { class: 'spec', text: 'Body · 15 / 1.55' }), el('div', { text: 'Ask Claude to add a show, find a movie or fix your subtitles - it talks to Sonarr, Radarr and friends for you.' })]),
      el('div', { class: 'type-row' }, [el('div', { class: 'spec', text: 'Mono · 13' }), el('code', { text: 'https://mcp-arr.home.lan/mcp' })]),
      el('p', { class: 'note', text: 'Font stack: ' + hand })
    ])]);

    sections.push(['shape', brandSection('shape', 'Shapes & lines', 'Nothing is perfectly round or straight. Corners use uneven radii, outlines are thick ink, shadows are hard offsets like a paper cut-out, and shading is diagonal hatching - never gradients or blur.', [
      el('div', { class: 'shapes' }, [
        el('div', { class: 'panel shape-demo' }, [el('strong', { text: 'Wobbly corners' }), el('code', { text: '16px 20px 14px 22px / 20px 14px 22px 16px' })]),
        el('div', { class: 'panel shape-demo hard' }, [el('strong', { text: 'Hard shadow' }), el('code', { text: '4px 5px 0 (8px 9px for emphasis)' })]),
        el('div', { class: 'panel shape-demo hatchy' }, [el('strong', { text: 'Hatching' }), el('code', { text: '38° lines, 9 px apart, 35% ink' })]),
        el('div', { class: 'panel shape-demo inky' }, [el('strong', { text: 'Ink line' }), el('code', { text: '2.5-3 px, round caps & joins' })])
      ])
    ])]);

    var iconIds = ['core'].concat(d.services.map(function (s) { return s.id; }));
    var iconNames = { core: 'Claude' };
    d.services.forEach(function (s) { iconNames[s.id] = s.displayName.split(' (')[0]; });
    sections.push(['icons', brandSection('icons', 'Illustrations', 'Each service is a little object you could doodle in a margin: an old TV for Sonarr, a film reel for Radarr, a note for Lidarr. Flat palette fills, thick ink outline, hatching for the shadow side. Disabled services fade to grey.', [
      el('div', { class: 'icon-grid' }, iconIds.map(function (id) {
        var svg = svgEl('svg', { viewBox: '-84 -92 168 176', 'aria-hidden': 'true' });
        svg.appendChild(svgEl('g', {}, ICONS[id] || ''));
        return el('div', { class: 'icon-cell' }, [svg, el('div', { text: iconNames[id] || id })]);
      }))
    ])]);

    var msg = el('div', { class: 'msg' });
    sections.push(['ui', brandSection('ui', 'Components', 'Buttons look like stickers you can press: they drop into their shadow when clicked. One primary (terracotta) action per card.', [
      el('div', { class: 'row' }, [el('button', { class: 'primary', text: 'Save' }), el('button', { text: 'Test' }), el('button', { class: 'danger', text: 'Remove' }), el('button', { class: 'link', text: 'Text link' }), el('button', { text: 'Disabled', disabled: true })]),
      el('div', { class: 'row' }, [el('span', { class: 'pill ok', text: 'Enabled' }), el('span', { class: 'pill warn', text: 'Expires soon' }), el('span', { class: 'pill', text: 'Not configured' })]),
      el('div', { class: 'msg ok', text: 'Connected - version 4.0.11' }),
      el('div', { class: 'msg warn', text: 'Follow the prompt from your browser or device…' }),
      el('div', { class: 'msg err', text: 'Connection failed - check the URL and API key.' }),
      el('label', { text: 'Text field' }), el('input', { type: 'text', placeholder: 'e.g. http://localhost:8989' }), msg
    ])]);

    var demoHub = el('div', { class: 'panel hub demo' }, [phone.matches ? hubSketchPhone(d.services) : hubSketch(d.services)]);
    var demoBtn = el('button', { class: 'primary', text: 'Send a pretend call', onclick: function () { demoCall(demoHub, d.services, true); } });
    var failBtn = el('button', { text: 'Pretend it failed', onclick: function () { demoCall(demoHub, d.services, false); } });
    sections.push(['motion', brandSection('motion', 'Motion', 'Animation explains what the AI is doing - never decoration for its own sake. While a tool call runs, ink flows down the arrow and the brain wiggles while it thinks. When the answer is back, the service hops and a +1 floats up; a failure shakes and leaves a red !. With "reduce motion" switched on, only the +1 fades.', [
      demoHub, el('div', { class: 'row' }, [demoBtn, failBtn])
    ])]);

    sections.push(['voice', brandSection('voice', 'Voice', 'Talk like a helpful friend who knows media servers: short, warm, plain words. Say what happened, then what to do next.', [
      el('div', { class: 'dodont' }, [
        el('div', { class: 'do' }, [el('strong', { text: '✓ Say' }), el('p', { text: 'Connection failed - check the URL and API key.' }), el('p', { text: 'Waiting for the first call - ask Claude about your library!' }), el('p', { text: 'TV, Movies, Music, Subtitles' })]),
        el('div', { class: 'dont-say' }, [el('strong', { text: '✗ Avoid' }), el('p', { text: 'ECONNREFUSED 127.0.0.1:8989 (HTTP 0)' }), el('p', { text: 'No data available.' }), el('p', { text: 'Series resources, movie entities' })])
      ]),
      el('p', { class: 'note', text: 'Sentence case everywhere except the MCP-ARR wordmark. No exclamation marks in errors. Name services by what they do (Sonarr (TV)).' })
    ])]);

    sections.push(['tokens', brandSection('tokens', 'Design tokens', 'Copy these CSS custom properties to build something that matches.', [
      el('pre', { text: tokensCss() }), el('div', { class: 'row' }, [copyButton(tokensCss)])
    ])]);

    var titles = { logo: 'Logo', color: 'Colour', type: 'Type', shape: 'Shapes', icons: 'Illustrations', ui: 'Components', motion: 'Motion', voice: 'Voice', tokens: 'Tokens' };
    sections.forEach(function (s) {
      toc.appendChild(el('button', { type: 'button', text: titles[s[0]], onclick: function () { var t = document.getElementById('brand-' + s[0]); if (t) t.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }); } }));
    });
    return [el('section', null, [el('h2', { text: 'Brand guide' }), hero, toc])].concat(sections.map(function (s) { return s[1]; }));
  }

  function tokensCss() {
    var light = BRAND_COLORS.concat(STATUS_COLORS.map(function (c) { return [c[0], c[1], c[2], c[3]]; }));
    return ':root {\n' + light.map(function (c) { return '  --' + c[1] + ': ' + c[2] + ';'; }).join('\n') +
      '\n  --radius: 16px 20px 14px 22px / 20px 14px 22px 16px;\n  --shadow: 4px 5px 0 rgba(59, 50, 42, .16);\n  --ink-width: 2.5px;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n' +
      light.map(function (c) { return '    --' + c[1] + ': ' + c[3] + ';'; }).join('\n') + '\n  }\n}';
  }

  var demoId = -1;
  function demoCall(panel, services, ok) {
    var svg = panel.querySelector('svg');
    var on = services.filter(function (s) { return s.configured; });
    var pool = (on.length ? on : services).map(function (s) { return s.id; }).concat(['core']);
    var svc = pool[Math.floor(Math.random() * pool.length)];
    var id = demoId--;
    animateHub({ id: id, phase: 'start', service: svc }, svg);
    setTimeout(function () { animateHub({ id: id, phase: 'end', service: svc, ok: ok }, svg); }, 900 + Math.random() * 700);
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
    var tabs = [['services', 'Services'], ['mine', 'My activity'], ['connect', 'Connect'], ['tokens', 'Access tokens'], ['passkeys', 'My sign-in']];
    if (isAdmin) tabs.push(['users', 'Users'], ['settings', 'Settings'], ['certificates', 'Certificates'], ['security', 'Security']);
    else tabs.push(['certificates', 'Certificates']);
    tabs.push(['brand', 'Brand']);
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
        case 'settings': view = [viewSettings(d, redraw)]; break;
        case 'certificates': view = [viewCertificates(d)]; break;
        case 'security': view = [viewSecurity(d)]; break;
        case 'brand': view = viewBrand(d); break;
        case 'mine': view = [viewMine(d)]; break;
      }
      content.replaceChildren.apply(content, view);
      labelTables(content);
      redrawNow = redraw;
    }
    redraw();
    app.replaceChildren(nav, content);
    startLive();
  }

  function renderConsent(requestId, user) {
    return api('GET', '/oauth/request/' + requestId).then(function (r) {
      var msg = el('div', { class: 'msg' });
      function finish(action) {
        approve.disabled = deny.disabled = true;
        api('POST', '/oauth/request/' + requestId + '/' + action).then(function (res) {
          history.replaceState(null, '', '/admin');
          location.href = res.redirect;
        }, function (e) { approve.disabled = deny.disabled = false; showMsg(msg, 'err', e.message); });
      }
      var approve = el('button', { class: 'primary big', type: 'button', text: 'Allow access', onclick: function () { finish('approve'); } });
      var deny = el('button', { type: 'button', text: 'Cancel', onclick: function () { finish('deny'); } });
      who.classList.remove('hidden');
      whoName.textContent = user.name + ' · ' + user.role;
      app.replaceChildren(el('div', { class: 'center panel' }, [
        el('h2', { text: 'Connect ' + r.clientName + '?' }),
        el('p', { text: r.clientName + ' (' + r.redirectHost + ') wants to use your *arr services through this server as ' + r.user + '.' }),
        el('p', { class: 'muted', text: 'It can then run the same tools you can, including changing your library. You can revoke it any time under "Access tokens". Only continue if you started this connection yourself.' }),
        el('div', { class: 'row' }, [approve, deny]), msg
      ]));
    }, function (e) {
      history.replaceState(null, '', '/admin');
      app.replaceChildren(el('div', { class: 'msg err', text: e.message }));
    });
  }

  function load() {
    var m = /invite=([A-Za-z0-9_-]+)/.exec(location.hash);
    var oauthReq = /oauth=([A-Za-z0-9_-]+)/.exec(location.hash);
    return api('GET', '/state').then(function (s) {
      lastState = s;
      if (m && !s.user) return renderInvite(m[1]);
      if (s.setupRequired) return renderSetup();
      if (!s.user) return renderLogin(s);
      if (oauthReq) return renderConsent(oauthReq[1], s.user);
      return api('GET', '/overview').then(renderMain);
    }).catch(function (e) {
      if (e.status === 401) return renderLogin(lastState);
      app.replaceChildren(el('div', { class: 'msg err', text: 'Error: ' + e.message }));
    });
  }

  document.getElementById('logout').addEventListener('click', function () { stopLive(); api('POST', '/logout').then(load); });
  load();
})();
</script>
</body>
</html>
`;

export function renderAdminPage(nonce: string): string {
  return PAGE.split('__NONCE__').join(nonce);
}
