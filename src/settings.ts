/**
 * Server settings that can be changed in the web UI (HTTP mode).
 *
 * Every setting is named after its environment variable. The effective value is, in order:
 * the environment variable (read-only in the UI), the value saved in the encrypted config file,
 * the default. Startup settings (PUBLIC_URL, PORT, ...) and settings that would let a web UI
 * admin run programs on the server (ACME_DNS_HOOK) can only be set in the environment.
 */

export type SettingType = 'select' | 'text' | 'secret' | 'bool' | 'number' | 'list' | 'url' | 'email';

export interface SettingDef {
  key: string;
  group: 'tls' | 'acme' | 'dns' | 'access';
  label: string;
  type: SettingType;
  options?: { value: string; label: string }[];
  /** Default value (as a string; '' = unset). */
  default?: string;
  help?: string;
  placeholder?: string;
  /** Show only when every listed setting has one of the listed values (UI hint, also used for validation). */
  showIf?: Record<string, string[]>;
  /** Other environment variable names that set the same value. */
  aliases?: string[];
  min?: number;
  max?: number;
  /** Rarely needed - shown under "Advanced" in the UI. */
  advanced?: boolean;
}

const ACME = { TLS_MODE: ['acme'] };
const DNS = { TLS_MODE: ['acme'], ACME_CHALLENGE: ['dns-01'] };

export const SETTING_DEFS: SettingDef[] = [
  {
    key: 'TLS_MODE', group: 'tls', label: 'Certificate', type: 'select', default: 'internal',
    options: [
      { value: 'internal', label: 'Built-in certificate authority (works offline, install the root certificate on your devices)' },
      { value: 'acme', label: "Let's Encrypt / ACME (publicly trusted, needs a domain you own)" },
      { value: 'file', label: 'Own certificate files' },
      { value: 'off', label: 'Off - plain HTTP behind a reverse proxy that terminates HTTPS' },
    ],
  },
  { key: 'TLS_SANS', group: 'tls', label: 'Extra names for the certificate', type: 'list', placeholder: 'mcp-arr, 192.168.1.10', help: 'Comma-separated host names / IP addresses in addition to the PUBLIC_URL host (IPs are skipped for ACME).', showIf: { TLS_MODE: ['internal', 'acme'] } },
  { key: 'TLS_CA_NAME_CONSTRAINTS', group: 'tls', label: 'CA may issue for', type: 'list', placeholder: 'home.lan, 192.168.1.10', help: 'Domains/IPs the built-in CA is restricted to. Default: exactly the certificate names. Changing it creates a new CA (reinstall the root certificate).', showIf: { TLS_MODE: ['internal'] } },
  { key: 'TLS_CERT_FILE', group: 'tls', label: 'Certificate file (PEM, full chain)', type: 'text', placeholder: '/certs/fullchain.pem', showIf: { TLS_MODE: ['file'] } },
  { key: 'TLS_KEY_FILE', group: 'tls', label: 'Private key file (PEM)', type: 'text', placeholder: '/certs/privkey.pem', showIf: { TLS_MODE: ['file'] } },

  { key: 'ACME_EMAIL', group: 'acme', label: 'Contact e-mail', type: 'email', placeholder: 'you@example.com', help: 'Optional. Used by the CA for important notices about your account.', showIf: ACME },
  { key: 'ACME_STAGING', group: 'acme', label: "Use Let's Encrypt staging (test certificates, not trusted)", type: 'bool', default: 'false', showIf: ACME },
  { key: 'ACME_DOMAINS', group: 'acme', label: 'Certificate names', type: 'list', placeholder: 'mcp-arr.example.com, *.example.com', help: 'Default: the PUBLIC_URL host plus the DNS names above. Wildcards need DNS validation.', showIf: ACME },
  {
    key: 'ACME_CHALLENGE', group: 'acme', label: 'Validation', type: 'select', default: 'http-01', showIf: ACME,
    options: [
      { value: 'http-01', label: 'HTTP - the server is reachable from the internet on port 80' },
      { value: 'dns-01', label: 'DNS - LAN-only server or wildcard (a DNS record is created for the check)' },
    ],
  },
  { key: 'ACME_HTTP_PORT', group: 'acme', label: 'HTTP validation port', type: 'number', min: 1, max: 65535, help: 'Port 80 on the internet must reach this port (Docker: publish "80:8080").', showIf: { TLS_MODE: ['acme'], ACME_CHALLENGE: ['http-01'] } },

  {
    key: 'ACME_DNS_PROVIDER', group: 'dns', label: 'DNS provider', type: 'select', default: '', showIf: DNS,
    options: [
      { value: 'cloudflare', label: 'Cloudflare (API token)' },
      { value: 'acme-dns', label: 'acme-dns - any DNS provider, one-time CNAME record, no DNS credentials' },
      { value: 'exec', label: 'Own script (ACME_DNS_HOOK, environment only)' },
    ],
  },
  { key: 'CLOUDFLARE_DNS_API_TOKEN', group: 'dns', label: 'Cloudflare API token', type: 'secret', aliases: ['CF_DNS_API_TOKEN'], help: 'Permissions: Zone - Zone - Read and Zone - DNS - Edit, ideally limited to this zone.', showIf: { ...DNS, ACME_DNS_PROVIDER: ['cloudflare'] } },
  { key: 'CLOUDFLARE_ZONE_ID', advanced: true, group: 'dns', label: 'Cloudflare zone ID (optional)', type: 'text', help: 'Skips the zone lookup (then the token only needs DNS:Edit).', showIf: { ...DNS, ACME_DNS_PROVIDER: ['cloudflare'] } },
  { key: 'ACMEDNS_API_BASE', group: 'dns', label: 'acme-dns server', type: 'url', placeholder: 'https://auth.acme-dns.io', help: 'Default: the public auth.acme-dns.io. Running your own is more reliable.', showIf: { ...DNS, ACME_DNS_PROVIDER: ['acme-dns'] } },
  { key: 'ACMEDNS_USERNAME', group: 'dns', label: 'acme-dns username (optional)', type: 'text', help: 'Leave the three account fields empty to register an account automatically.', showIf: { ...DNS, ACME_DNS_PROVIDER: ['acme-dns'] } },
  { key: 'ACMEDNS_PASSWORD', group: 'dns', label: 'acme-dns password (optional)', type: 'secret', showIf: { ...DNS, ACME_DNS_PROVIDER: ['acme-dns'] } },
  { key: 'ACMEDNS_SUBDOMAIN', group: 'dns', label: 'acme-dns subdomain (optional)', type: 'text', showIf: { ...DNS, ACME_DNS_PROVIDER: ['acme-dns'] } },
  { key: 'ACME_DNS_RESOLVERS', advanced: true, group: 'dns', label: 'Resolvers for the propagation check', type: 'list', placeholder: '1.1.1.1, 8.8.8.8', showIf: DNS },
  { key: 'ACME_DNS_TIMEOUT', advanced: true, group: 'dns', label: 'Wait for the DNS record (seconds)', type: 'number', min: 0, max: 3600, placeholder: '300', showIf: DNS },
  { key: 'ACME_DNS_DELAY', advanced: true, group: 'dns', label: 'Extra delay after the record is visible (seconds)', type: 'number', min: 0, max: 600, placeholder: '10', showIf: DNS },

  { key: 'ACME_DIRECTORY_URL', advanced: true, group: 'acme', label: 'Other ACME CA (directory URL)', type: 'url', placeholder: "Let's Encrypt", help: 'E.g. ZeroSSL https://acme.zerossl.com/v2/DV90 or your own step-ca. Overrides the staging switch.', showIf: ACME },
  { key: 'ACME_EAB_KID', advanced: true, group: 'acme', label: 'External account binding: key ID', type: 'text', help: 'Only for CAs that require it (e.g. ZeroSSL, Google).', showIf: ACME },
  { key: 'ACME_EAB_HMAC_KEY', advanced: true, group: 'acme', label: 'External account binding: HMAC key', type: 'secret', showIf: ACME },
  { key: 'ACME_PROFILE', advanced: true, group: 'acme', label: 'Certificate profile', type: 'text', placeholder: 'e.g. shortlived', showIf: ACME },

  {
    key: 'OAUTH', group: 'access', label: 'Sign-in for Claude / ChatGPT connectors (OAuth)', type: 'select', default: 'auto',
    options: [
      { value: 'auto', label: 'Automatic - on when the certificate is publicly trusted' },
      { value: 'on', label: 'On (you vouch for the certificate)' },
      { value: 'off', label: 'Off' },
    ],
  },
  { key: 'OAUTH_ALLOWED_REDIRECT_HOSTS', group: 'access', label: 'Extra connector redirect hosts', type: 'list', placeholder: 'connectors.example.com', help: 'In addition to claude.ai, claude.com, chatgpt.com and openai.com.' },
  { key: 'TRUST_PROXY', group: 'access', label: 'Behind my own reverse proxy (trust X-Forwarded-For for rate limiting)', type: 'bool', default: 'false' },
];

/** Shown read-only: only the environment can set these. */
export const STARTUP_KEYS = ['PUBLIC_URL', 'PORT', 'HOST', 'MCP_PATH', 'ACME_DNS_HOOK', 'TLS_LEAF_DAYS'];

const DEF_BY_KEY = new Map(SETTING_DEFS.map(d => [d.key, d]));

export function isSettingKey(key: string): boolean {
  return DEF_BY_KEY.has(key);
}

export type SettingSource = 'env' | 'file' | 'default';

function envValue(env: NodeJS.ProcessEnv, def: SettingDef): string | undefined {
  for (const k of [def.key, ...(def.aliases ?? [])]) {
    const v = env[k];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

function dynamicDefault(def: SettingDef, env: NodeJS.ProcessEnv): string | undefined {
  if (def.key === 'ACME_HTTP_PORT') return env.MCP_ARR_DOCKER ? '8080' : '80';
  return undefined;
}

export interface EffectiveSetting {
  value: string;
  source: SettingSource;
  /** The environment variable that sets it (when source = env). */
  envKey?: string;
}

export function effectiveSettings(stored: Record<string, string>, env: NodeJS.ProcessEnv): Record<string, EffectiveSetting> {
  const out: Record<string, EffectiveSetting> = {};
  for (const def of SETTING_DEFS) {
    const fromEnv = envValue(env, def);
    if (fromEnv !== undefined) {
      out[def.key] = { value: fromEnv, source: 'env', envKey: [def.key, ...(def.aliases ?? [])].find(k => env[k]) };
    } else if (stored[def.key] !== undefined && stored[def.key] !== '') {
      out[def.key] = { value: stored[def.key], source: 'file' };
    } else {
      out[def.key] = { value: dynamicDefault(def, env) ?? def.default ?? '', source: 'default' };
    }
  }
  // The validation method follows the DNS provider unless it is set explicitly
  if (out.ACME_CHALLENGE.source === 'default' && out.ACME_DNS_PROVIDER.value) out.ACME_CHALLENGE.value = 'dns-01';
  return out;
}

/**
 * An environment object for the existing parsers: real environment variables win, then the
 * saved settings. Default values are not filled in (the parsers have their own defaults).
 */
export function mergedEnv(stored: Record<string, string>, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  for (const def of SETTING_DEFS) {
    if (envValue(env, def) !== undefined) continue;
    const v = stored[def.key];
    if (v !== undefined && v !== '') out[def.key] = v;
    else delete out[def.key];
  }
  return out;
}

/** Validate and normalise one value from the UI. Returns '' for "unset". */
export function normaliseSetting(key: string, raw: unknown): string {
  const def = DEF_BY_KEY.get(key);
  if (!def) throw new Error(`Unknown setting ${key}`);
  if (raw === null || raw === undefined) return '';
  if (typeof raw !== 'string' && typeof raw !== 'boolean' && typeof raw !== 'number') throw new Error(`${def.label}: invalid value`);
  let v = String(raw).trim();
  if (v.length > 4096) throw new Error(`${def.label}: too long`);
  if (/[\r\n\0]/.test(v)) throw new Error(`${def.label}: must be a single line`);
  if (!v) return '';
  switch (def.type) {
    case 'select':
      if (!def.options!.some(o => o.value === v)) throw new Error(`${def.label}: unknown option '${v}'`);
      break;
    case 'bool':
      if (v !== 'true' && v !== 'false') throw new Error(`${def.label}: must be true or false`);
      break;
    case 'number': {
      const n = Number(v);
      if (!Number.isInteger(n) || (def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) {
        throw new Error(`${def.label}: must be a whole number${def.min !== undefined ? ` between ${def.min} and ${def.max}` : ''}`);
      }
      v = String(n);
      break;
    }
    case 'list':
      v = v.split(',').map(x => x.trim()).filter(Boolean).join(',');
      break;
    case 'url': {
      let u: URL;
      try {
        u = new URL(v);
      } catch {
        throw new Error(`${def.label}: not a valid URL`);
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${def.label}: must start with https://`);
      break;
    }
    case 'email':
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new Error(`${def.label}: not a valid e-mail address`);
      break;
  }
  return v;
}

export function settingDef(key: string): SettingDef | undefined {
  return DEF_BY_KEY.get(key);
}
