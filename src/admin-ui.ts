/**
 * Self-contained admin web UI (no external assets, CSP-nonce protected).
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
header { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--panel); }
header h1 { font-size: 18px; margin: 0; }
header .sub { color: var(--muted); font-size: 13px; }
main { max-width: 1100px; margin: 0 auto; padding: 20px 16px 60px; }
section { margin-bottom: 28px; }
h2 { font-size: 16px; margin: 0 0 12px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
.card-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.card-head strong { font-size: 15px; }
label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 3px; }
input[type=text], input[type=password], input[type=url] {
  width: 100%; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--input); color: var(--text); font: inherit;
}
input:disabled { opacity: .65; }
.row { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
button { font: inherit; font-size: 14px; padding: 7px 14px; border-radius: 6px; border: 1px solid var(--border); background: var(--panel); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger { color: var(--err); }
button:disabled { opacity: .5; cursor: default; }
.pill { font-size: 12px; padding: 2px 8px; border-radius: 999px; background: var(--code); color: var(--muted); white-space: nowrap; }
.pill.ok { background: var(--ok-bg); color: var(--ok); }
.note { font-size: 12px; color: var(--muted); margin-top: 3px; }
.msg { font-size: 13px; margin-top: 10px; padding: 6px 10px; border-radius: 6px; display: none; word-break: break-word; }
.msg.ok { display: block; background: var(--ok-bg); color: var(--ok); }
.msg.err { display: block; background: var(--err-bg); color: var(--err); }
.msg.warn { display: block; background: var(--warn-bg); color: var(--warn); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; }
pre { background: var(--code); padding: 10px 12px; border-radius: 6px; overflow-x: auto; margin: 6px 0 0; white-space: pre-wrap; word-break: break-all; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid var(--border); }
th { color: var(--muted); font-weight: 500; font-size: 12px; }
.center { max-width: 380px; margin: 10vh auto; }
.muted { color: var(--muted); }
.hidden { display: none !important; }
</style>
</head>
<body>
<header>
  <div><h1>mcp-arr</h1><div class="sub">MCP server for the *arr suite</div></div>
  <button id="logout" class="hidden">Log out</button>
</header>
<main id="app"><p class="muted">Loading…</p></main>

<script nonce="__NONCE__">
(function () {
  'use strict';
  var app = document.getElementById('app');
  var logoutBtn = document.getElementById('logout');

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'text') e.textContent = v;
        else if (k === 'class') e.className = v;
        else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }

  function api(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    } else if (method !== 'GET') {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = '{}';
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

  function showMsg(node, kind, text) {
    node.className = 'msg ' + kind;
    node.textContent = text;
  }

  function copyButton(getText) {
    var b = el('button', { text: 'Copy', onclick: function () {
      navigator.clipboard.writeText(getText()).then(function () {
        b.textContent = 'Copied';
        setTimeout(function () { b.textContent = 'Copy'; }, 1500);
      });
    } });
    return b;
  }

  // ---------- views ----------

  function renderSetup() {
    logoutBtn.classList.add('hidden');
    var code = el('input', { type: 'text', autocomplete: 'off', placeholder: 'XXXX-XXXX' });
    var pw = el('input', { type: 'password', autocomplete: 'new-password' });
    var pw2 = el('input', { type: 'password', autocomplete: 'new-password' });
    var msg = el('div', { class: 'msg' });
    var form = el('form', { onsubmit: function (ev) {
      ev.preventDefault();
      if (pw.value !== pw2.value) return showMsg(msg, 'err', 'Passwords do not match');
      api('POST', '/setup', { code: code.value, password: pw.value }).then(load, function (e) { showMsg(msg, 'err', e.message); });
    } }, [
      el('label', { text: 'Setup code (printed in the server / container log)' }), code,
      el('label', { text: 'New admin password (min. 8 characters)' }), pw,
      el('label', { text: 'Repeat password' }), pw2,
      el('div', { class: 'row' }, [el('button', { class: 'primary', type: 'submit', text: 'Create admin password' })]),
      msg
    ]);
    app.replaceChildren(el('div', { class: 'center panel' }, [
      el('h2', { text: 'First-run setup' }),
      el('p', { class: 'muted', text: 'Set the password used to manage this server. Tip: set ADMIN_PASSWORD as an environment variable to skip this step.' }),
      form
    ]));
    code.focus();
  }

  function renderLogin() {
    logoutBtn.classList.add('hidden');
    var pw = el('input', { type: 'password', autocomplete: 'current-password' });
    var msg = el('div', { class: 'msg' });
    app.replaceChildren(el('div', { class: 'center panel' }, [
      el('h2', { text: 'Log in' }),
      el('form', { onsubmit: function (ev) {
        ev.preventDefault();
        api('POST', '/login', { password: pw.value }).then(load, function (e) { showMsg(msg, 'err', e.message); });
      } }, [
        el('label', { text: 'Admin password' }), pw,
        el('div', { class: 'row' }, [el('button', { class: 'primary', type: 'submit', text: 'Log in' })]),
        msg
      ])
    ]));
    pw.focus();
  }

  function sourceNote(source, envName) {
    if (source === 'env') return el('div', { class: 'note', text: 'Set by environment variable ' + envName + ' (read-only here)' });
    return null;
  }

  function serviceCard(svc, onUpdated) {
    var urlInput = el('input', { type: 'url', value: svc.url, placeholder: svc.exampleUrl, disabled: svc.urlSource === 'env' });
    var keyInput = el('input', {
      type: 'password', autocomplete: 'off', disabled: svc.apiKeySource === 'env',
      placeholder: svc.hasApiKey ? 'Saved' + (svc.apiKeyHint ? ' (ends with ' + svc.apiKeyHint + ')' : '') + ' - leave empty to keep' : 'API key'
    });
    var msg = el('div', { class: 'msg' });
    var pill = el('span', { class: 'pill' + (svc.configured ? ' ok' : ''), text: svc.configured ? 'Enabled' : 'Not configured' });

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
      api('PUT', '/services/' + svc.id, payload()).then(function (r) {
        onUpdated(r);
        showMsg(msg, 'ok', 'Saved');
      }, function (e) { showMsg(msg, 'err', e.message); }).then(function () { saveBtn.disabled = false; });
    } });

    var clearBtn = (svc.urlSource !== 'env' || svc.apiKeySource !== 'env') && (svc.url || svc.hasApiKey)
      ? el('button', { class: 'danger', text: 'Remove', onclick: function () {
          if (!confirm('Remove the saved settings for ' + svc.displayName + '?')) return;
          var p = {};
          if (svc.urlSource !== 'env') p.url = '';
          if (svc.apiKeySource !== 'env') p.apiKey = '';
          api('PUT', '/services/' + svc.id, p).then(onUpdated, function (e) { showMsg(msg, 'err', e.message); });
        } })
      : null;

    return el('div', { class: 'panel' }, [
      el('div', { class: 'card-head' }, [el('strong', { text: svc.displayName }), pill]),
      el('label', { text: 'URL' }), urlInput, sourceNote(svc.urlSource, svc.envPrefix + '_URL'),
      el('label', { text: 'API key' }), keyInput, sourceNote(svc.apiKeySource, svc.envPrefix + '_API_KEY'),
      el('div', { class: 'row' }, [saveBtn, testBtn, clearBtn]),
      msg
    ]);
  }

  function renderConnect(data) {
    var endpoint = location.origin + '/mcp';
    var sec = data.security;
    var children = [el('h2', { text: 'Connect an MCP client' })];
    var body = [
      el('div', { class: 'muted', text: 'Endpoint (Streamable HTTP):' }),
      el('pre', { text: endpoint })
    ];
    if (sec.mcpAuthDisabled) {
      body.push(el('div', { class: 'msg warn', text: 'Authentication is disabled (MCP_AUTH_DISABLED=true). Anyone who can reach this server can use it.' }));
    } else {
      body.push(el('p', { class: 'muted', text: 'Clients authenticate with an access token (create one below) sent as "Authorization: Bearer <token>". Clients that cannot send headers can use ' + endpoint + '?token=<token>.' }));
    }
    body.push(el('div', { class: 'muted', text: 'Claude Code:' }));
    body.push(el('pre', { text: 'claude mcp add --transport http arr ' + endpoint + (sec.mcpAuthDisabled ? '' : ' --header "Authorization: Bearer <token>"') }));
    body.push(el('div', { class: 'muted', text: 'Claude Desktop / other stdio-only clients (via mcp-remote):' }));
    var json = JSON.stringify({ mcpServers: { arr: { command: 'npx', args: ['-y', 'mcp-remote', endpoint].concat(sec.mcpAuthDisabled ? [] : ['--header', 'Authorization: Bearer <token>']) } } }, null, 2);
    body.push(el('pre', { text: json }));
    children.push(el('div', { class: 'panel' }, body));
    return el('section', null, children);
  }

  function renderTokens(data, refresh) {
    var sec = data.security;
    var section = el('section', null, [el('h2', { text: 'Access tokens' })]);
    var panel = el('div', { class: 'panel' });
    section.appendChild(panel);
    if (sec.envTokenSet) panel.appendChild(el('p', { class: 'muted', text: 'MCP_AUTH_TOKEN is set in the environment and is also accepted.' }));

    var created = el('div');
    var rows = data.tokens.map(function (t) {
      return el('tr', null, [
        el('td', { text: t.name }),
        el('td', null, [el('code', { text: '…' + t.hint })]),
        el('td', { text: new Date(t.createdAt).toLocaleString() }),
        el('td', { text: t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : 'never' }),
        el('td', null, [el('button', { class: 'danger', text: 'Revoke', onclick: function () {
          if (!confirm('Revoke token "' + t.name + '"? Clients using it will lose access.')) return;
          api('DELETE', '/tokens/' + t.id).then(refresh);
        } })])
      ]);
    });
    if (rows.length) {
      panel.appendChild(el('table', null, [
        el('thead', null, [el('tr', null, [el('th', { text: 'Name' }), el('th', { text: 'Token' }), el('th', { text: 'Created' }), el('th', { text: 'Last used' }), el('th')])]),
        el('tbody', null, rows)
      ]));
    } else if (!sec.envTokenSet && !sec.mcpAuthDisabled) {
      panel.appendChild(el('div', { class: 'msg warn', text: 'No access tokens yet - MCP clients cannot connect until you create one.' }));
    }

    var nameInput = el('input', { type: 'text', placeholder: 'e.g. Claude Desktop on laptop' });
    var msg = el('div', { class: 'msg' });
    panel.appendChild(el('form', { onsubmit: function (ev) {
      ev.preventDefault();
      api('POST', '/tokens', { name: nameInput.value }).then(function (r) {
        refresh().then(function () {
          var box = document.getElementById('new-token');
          if (box) box.replaceChildren(
            el('div', { class: 'msg ok', text: 'Token created. Copy it now - it will not be shown again.' }),
            el('div', { class: 'row' }, [el('code', { text: r.token }), copyButton(function () { return r.token; })])
          );
        });
      }, function (e) { showMsg(msg, 'err', e.message); });
    } }, [
      el('label', { text: 'New token name' }), nameInput,
      el('div', { class: 'row' }, [el('button', { class: 'primary', type: 'submit', text: 'Create token' })]),
      msg
    ]));
    created.id = 'new-token';
    panel.appendChild(created);
    return section;
  }

  function renderSecurity(data) {
    var sec = data.security;
    var panel = el('div', { class: 'panel' }, [
      el('p', null, ['Config file: ', el('code', { text: sec.configPath || '(none)' })]),
      el('p', { text: sec.encryption
        ? 'API keys are encrypted at rest (CONFIG_ENCRYPTION_KEY is set).'
        : 'API keys are stored in plain text in the config file. Set CONFIG_ENCRYPTION_KEY to encrypt them.' })
    ]);
    if (sec.passwordFromEnv) {
      panel.appendChild(el('p', { class: 'muted', text: 'The admin password is set by the ADMIN_PASSWORD environment variable.' }));
    } else {
      var cur = el('input', { type: 'password', autocomplete: 'current-password' });
      var next = el('input', { type: 'password', autocomplete: 'new-password' });
      var msg = el('div', { class: 'msg' });
      panel.appendChild(el('form', { onsubmit: function (ev) {
        ev.preventDefault();
        api('POST', '/password', { current: cur.value, password: next.value }).then(function () {
          cur.value = ''; next.value = '';
          showMsg(msg, 'ok', 'Password changed');
        }, function (e) { showMsg(msg, 'err', e.message); });
      } }, [
        el('h2', { text: 'Change admin password' }),
        el('label', { text: 'Current password' }), cur,
        el('label', { text: 'New password (min. 8 characters)' }), next,
        el('div', { class: 'row' }, [el('button', { type: 'submit', text: 'Change password' })]),
        msg
      ]));
    }
    return el('section', null, [el('h2', { text: 'Security' }), panel]);
  }

  function renderMain(data) {
    logoutBtn.classList.remove('hidden');
    var summary = el('p', { class: 'muted' });
    function setSummary(list) {
      summary.textContent = list.length ? 'Enabled: ' + list.join(', ') : 'No services enabled yet. Add a URL and API key below.';
    }
    setSummary(data.configuredSummary);

    var grid = el('div', { class: 'grid' });
    function drawServices(services) {
      grid.replaceChildren.apply(grid, services.map(function (s) {
        return serviceCard(s, function (r) { if (r && r.services) { drawServices(r.services); setSummary(r.configuredSummary); } });
      }));
    }
    drawServices(data.services);

    var tokensHolder = el('div');
    function refresh() {
      return api('GET', '/overview').then(function (d) { tokensHolder.replaceChildren(renderTokens(d, refresh)); });
    }
    tokensHolder.appendChild(renderTokens(data, refresh));

    app.replaceChildren(
      el('section', null, [el('h2', { text: 'Services' }), summary, grid]),
      renderConnect(data),
      tokensHolder,
      renderSecurity(data)
    );
  }

  function load() {
    return api('GET', '/state').then(function (s) {
      if (s.setupRequired) return renderSetup();
      if (!s.authenticated) return renderLogin();
      return api('GET', '/overview').then(renderMain);
    }).catch(function (e) {
      if (e.status === 401) return renderLogin();
      app.replaceChildren(el('div', { class: 'msg err', text: 'Error: ' + e.message }));
    });
  }

  logoutBtn.addEventListener('click', function () { api('POST', '/logout').then(load); });
  load();
})();
</script>
</body>
</html>
`;

export function renderAdminPage(nonce: string): string {
  return PAGE.split('__NONCE__').join(nonce);
}
