/**
 * Self-contained admin web UI (no external assets - works offline, CSP-nonce protected).
 * Passkeys use the browser's native WebAuthn API.
 * NOTE: the page source below must not contain backticks or dollar-brace sequences.
 */

const PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>mcp-arr admin</title>
<style nonce="__NONCE__">
:root {
  --bg: #f5f6f8; --panel: #ffffff; --text: #1d2330; --muted: #667085; --border: #e2e5ea;
  --accent: #3b6fe0; --accent-text: #ffffff; --ok: #16803c; --ok-bg: #e5f5ea; --err: #b42318; --err-bg: #fdecea;
  --warn: #8a5a00; --warn-bg: #fff4dc; --input: #ffffff; --code: #f0f2f5;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151b; --panel: #1b1f27; --text: #e6e8ec; --muted: #9aa3b2; --border: #2c323d;
    --accent: #6b95f2; --accent-text: #0d1117; --ok: #5fd38a; --ok-bg: #173323; --err: #ff8a80; --err-bg: #3a1c1c;
    --warn: #f2c063; --warn-bg: #3a2f14; --input: #141820; --code: #232833;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); }
header h1 { font-size: 18px; margin: 0; }
header .sub { color: var(--muted); font-size: 13px; }
.who { display: flex; align-items: center; gap: 10px; font-size: 14px; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 60px; }
nav.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 18px; }
nav.tabs button { border-radius: 999px; }
nav.tabs button.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
section { margin-bottom: 28px; }
h2 { font-size: 16px; margin: 0 0 12px; }
h3 { font-size: 14px; margin: 16px 0 6px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 14px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.grid .panel { margin-bottom: 0; }
.card-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 3px; }
input[type=text], input[type=password], input[type=url], select {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--input); color: var(--text); font: inherit;
}
input:disabled { opacity: .65; }
.row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; align-items: center; }
button, a.button { font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; text-decoration: none; display: inline-block; }
button.primary, a.button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger { color: var(--err); }
button.link { border: none; background: none; color: var(--accent); padding: 0; }
button:disabled { opacity: .5; cursor: default; }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--code); color: var(--muted); white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.pill.warn { background: var(--warn-bg); color: var(--warn); }
.pills { display: flex; gap: 6px; flex-wrap: wrap; }
.note { font-size: 12px; color: var(--muted); margin-top: 3px; }
.msg { font-size: 13px; margin-top: 10px; padding: 6px 10px; border-radius: 6px; display: none; word-break: break-word; }
.msg.ok { display: block; background: var(--ok-bg); color: var(--ok); }
.msg.err { display: block; background: var(--err-bg); color: var(--err); }
.msg.warn { display: block; background: var(--warn-bg); color: var(--warn); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
code { word-break: break-all; }
p, strong, td { overflow-wrap: anywhere; }
pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow-x: auto; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { color: var(--muted); font-weight: 500; font-size: 12px; }
td select { width: auto; padding: 4px 6px; }
details { margin-top: 8px; }
summary { cursor: pointer; font-weight: 500; }
details > div { padding: 6px 0 0 14px; color: var(--muted); font-size: 14px; }
.center { max-width: 420px; margin: 8vh auto; }
.muted { color: var(--muted); }
.hidden { display: none !important; }
.big { width: 100%; padding: 11px; font-size: 15px; }
</style>
</head>
<body>
<header>
  <div><h1>mcp-arr</h1><div class="sub">MCP server for the *arr suite</div></div>
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
      el('div', { class: 'card-head' }, [el('strong', { text: svc.displayName }), el('span', { class: 'pill' + (svc.configured ? ' ok' : ''), text: svc.configured ? 'Enabled' : 'Not configured' })]),
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
      return [el('section', null, [el('h2', { text: 'Services' }), el('div', { class: 'panel' }, [
        el('div', { class: 'pills' }, d.services.map(function (s) { return el('span', { class: 'pill' + (s.configured ? ' ok' : ''), text: s.displayName }); })),
        el('p', { class: 'note', text: 'Only admins can change service settings.' })
      ])])];
    }
    var grid = el('div', { class: 'grid' }, d.services.map(function (s) {
      return serviceCard(s, function (r) { d.services = r.services; d.configuredSummary = r.configuredSummary; redraw(); });
    }));
    return [el('section', null, [el('h2', { text: 'Services' }), summary, grid])];
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
