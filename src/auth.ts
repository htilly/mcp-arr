/**
 * Per-user authentication with passkeys (WebAuthn) for the web UI.
 *
 * Flows that register a passkey:
 *  - setup:    first admin, requires the one-time setup code printed to the server log
 *  - invite:   new user via a single-use invite link created by an admin
 *  - add:      a logged-in user adds another passkey (e.g. phone + laptop)
 *  - recovery: new admin when all passkeys are lost; requires ADMIN_RECOVERY=true and the
 *              recovery code printed to the server log
 *
 * Sign-in uses discoverable credentials with user verification (no username needed).
 */

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { ConfigStore, Role, StoredUser, safeEqual } from './config-store.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type RegistrationKind = 'setup' | 'invite' | 'add' | 'recovery';

interface RegistrationFlow {
  purpose: 'register';
  kind: RegistrationKind;
  challenge: string;
  expires: number;
  handle: string; // base64url user handle
  name: string; // user name (new users)
  role: Role;
  userId?: string; // 'add' flow
  inviteId?: string; // 'invite' flow
}

interface LoginFlow {
  purpose: 'login';
  challenge: string;
  expires: number;
}

type Flow = RegistrationFlow | LoginFlow;

export interface AuthOptions {
  store: ConfigStore;
  rpID: string;
  origin: string;
  rpName?: string;
  recoveryEnabled: boolean;
}

function makeCode(): string {
  return randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})/, '$1-');
}

export class Auth {
  private readonly store: ConfigStore;
  readonly rpID: string;
  readonly origin: string;
  private readonly rpName: string;
  private flows = new Map<string, Flow>();
  private sessions = new Map<string, { userId: string; expires: number }>();
  private setupCode?: string;
  private recoveryCode?: string;

  constructor(opts: AuthOptions) {
    this.store = opts.store;
    this.rpID = opts.rpID;
    this.origin = opts.origin;
    this.rpName = opts.rpName ?? 'mcp-arr';
    if (this.store.listUsers().length === 0) this.setupCode = makeCode();
    else if (opts.recoveryEnabled) this.recoveryCode = makeCode();
  }

  get pendingSetupCode(): string | undefined {
    return this.setupCode;
  }

  get pendingRecoveryCode(): string | undefined {
    return this.recoveryCode;
  }

  get setupRequired(): boolean {
    return Boolean(this.setupCode);
  }

  get recoveryAvailable(): boolean {
    return Boolean(this.recoveryCode);
  }

  /** Remove expired flows and sessions. */
  cleanup(): void {
    const now = Date.now();
    for (const [id, f] of this.flows) if (f.expires < now) this.flows.delete(id);
    for (const [id, s] of this.sessions) if (s.expires < now) this.sessions.delete(id);
  }

  // ---------- sessions ----------

  createSession(userId: string): string {
    const sid = randomBytes(32).toString('base64url');
    this.sessions.set(sid, { userId, expires: Date.now() + SESSION_TTL_MS });
    return sid;
  }

  sessionUser(sid: string | undefined): StoredUser | undefined {
    if (!sid) return undefined;
    const s = this.sessions.get(sid);
    if (!s || s.expires < Date.now()) {
      this.sessions.delete(sid);
      return undefined;
    }
    const user = this.store.getUser(s.userId);
    if (!user) this.sessions.delete(sid);
    return user;
  }

  destroySession(sid: string | undefined): void {
    if (sid) this.sessions.delete(sid);
  }

  destroyUserSessions(userId: string): void {
    for (const [id, s] of this.sessions) if (s.userId === userId) this.sessions.delete(id);
  }

  get sessionTtlSeconds(): number {
    return SESSION_TTL_MS / 1000;
  }

  // ---------- registration ----------

  async startRegistration(input: {
    kind: RegistrationKind;
    name?: string;
    code?: string;
    inviteToken?: string;
    user?: StoredUser; // 'add'
  }): Promise<{ flowId: string; options: unknown }> {
    let role: Role = 'user';
    let handle = randomBytes(32).toString('base64url');
    let name = (input.name ?? '').trim();
    let inviteId: string | undefined;
    let excludeCredentials: { id: string; transports?: string[] }[] = [];

    switch (input.kind) {
      case 'setup':
        if (!this.setupCode) throw new AuthError(409, 'Setup already completed');
        if (!input.code || !safeEqual(input.code.trim().toUpperCase(), this.setupCode)) {
          throw new AuthError(403, 'Invalid setup code (see the server log)');
        }
        role = 'admin';
        break;
      case 'recovery':
        if (!this.recoveryCode) throw new AuthError(409, 'Recovery is not enabled (start the server with ADMIN_RECOVERY=true)');
        if (!input.code || !safeEqual(input.code.trim().toUpperCase(), this.recoveryCode)) {
          throw new AuthError(403, 'Invalid recovery code (see the server log)');
        }
        role = 'admin';
        break;
      case 'invite': {
        const invite = input.inviteToken ? this.store.findInvite(input.inviteToken) : undefined;
        if (!invite) throw new AuthError(403, 'This invite link is invalid or has expired');
        role = invite.role;
        inviteId = invite.id;
        break;
      }
      case 'add':
        if (!input.user) throw new AuthError(401, 'Not logged in');
        handle = input.user.handle;
        name = input.user.name;
        role = input.user.role;
        excludeCredentials = input.user.credentials.map(c => ({ id: c.id, transports: c.transports }));
        break;
    }
    if (input.kind !== 'add' && !name) throw new AuthError(400, 'Please enter your name');
    if (input.kind !== 'add' && this.store.isNameTaken(name)) throw new AuthError(400, 'That name is already taken');

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: name.slice(0, 64),
      userDisplayName: name.slice(0, 64),
      userID: Buffer.from(handle, 'base64url'),
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      timeout: CHALLENGE_TTL_MS,
    });

    const flowId = randomBytes(24).toString('base64url');
    this.flows.set(flowId, {
      purpose: 'register',
      kind: input.kind,
      challenge: options.challenge,
      expires: Date.now() + CHALLENGE_TTL_MS,
      handle,
      name,
      role,
      userId: input.user?.id,
      inviteId,
    });
    return { flowId, options };
  }

  async finishRegistration(
    flowId: string,
    response: RegistrationResponseJSON,
    credentialName: string | undefined,
    currentUser?: StoredUser
  ): Promise<StoredUser> {
    const flow = this.flows.get(flowId);
    this.flows.delete(flowId); // single use
    if (!flow || flow.purpose !== 'register' || flow.expires < Date.now()) {
      throw new AuthError(400, 'This request has expired - please try again');
    }
    if (flow.kind === 'add' && currentUser?.id !== flow.userId) throw new AuthError(403, 'Session mismatch');

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (error) {
      throw new AuthError(400, `Passkey registration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!verification.verified) throw new AuthError(400, 'Passkey registration could not be verified');

    const { credential } = verification.registrationInfo;
    if (this.store.findCredential(credential.id)) throw new AuthError(409, 'This passkey is already registered');
    const stored = {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports,
      name: (credentialName ?? '').trim() || 'Passkey',
    };

    switch (flow.kind) {
      case 'add':
        this.store.addCredential(flow.userId!, stored);
        return this.store.getUser(flow.userId!)!;
      case 'setup':
        if (!this.setupCode) throw new AuthError(409, 'Setup already completed');
        this.setupCode = undefined;
        return this.store.createUser(flow.name, 'admin', stored, flow.handle);
      case 'recovery':
        if (!this.recoveryCode) throw new AuthError(409, 'Recovery code already used');
        this.recoveryCode = undefined;
        return this.store.createUser(flow.name, 'admin', stored, flow.handle);
      case 'invite': {
        // Re-check the invite is still valid, then consume it
        if (!this.store.deleteInvite(flow.inviteId!)) throw new AuthError(403, 'This invite has already been used or revoked');
        return this.store.createUser(flow.name, flow.role, stored, flow.handle);
      }
    }
  }

  // ---------- name / password ----------

  /** Create a user that signs in with name + password (setup, recovery or invite flows). */
  registerWithPassword(input: {
    kind: Exclude<RegistrationKind, 'add'>;
    name?: string;
    password?: string;
    code?: string;
    inviteToken?: string;
  }): StoredUser {
    const name = (input.name ?? '').trim();
    let role: Role = 'user';
    let inviteId: string | undefined;
    switch (input.kind) {
      case 'setup':
        if (!this.setupCode) throw new AuthError(409, 'Setup already completed');
        if (!input.code || !safeEqual(input.code.trim().toUpperCase(), this.setupCode)) {
          throw new AuthError(403, 'Invalid setup code (see the server log)');
        }
        role = 'admin';
        break;
      case 'recovery':
        if (!this.recoveryCode) throw new AuthError(409, 'Recovery is not enabled (start the server with ADMIN_RECOVERY=true)');
        if (!input.code || !safeEqual(input.code.trim().toUpperCase(), this.recoveryCode)) {
          throw new AuthError(403, 'Invalid recovery code (see the server log)');
        }
        role = 'admin';
        break;
      case 'invite': {
        const invite = input.inviteToken ? this.store.findInvite(input.inviteToken) : undefined;
        if (!invite) throw new AuthError(403, 'This invite link is invalid or has expired');
        role = invite.role;
        inviteId = invite.id;
        break;
      }
    }
    if (!name) throw new AuthError(400, 'Please enter your name');
    let user: StoredUser;
    try {
      user = this.store.createUser(name, role, undefined, randomBytes(32).toString('base64url'), input.password ?? '');
    } catch (error) {
      throw new AuthError(400, error instanceof Error ? error.message : String(error));
    }
    // Consume one-time secrets only after the account exists
    if (input.kind === 'setup') this.setupCode = undefined;
    else if (input.kind === 'recovery') this.recoveryCode = undefined;
    else if (inviteId) this.store.deleteInvite(inviteId);
    return user;
  }

  loginWithPassword(name: string, password: string): StoredUser {
    const user = this.store.verifyPassword(name, password);
    if (!user) throw new AuthError(401, 'Wrong name or password');
    return user;
  }

  // ---------- login ----------

  async startLogin(): Promise<{ flowId: string; options: unknown }> {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'required',
      timeout: CHALLENGE_TTL_MS,
    });
    const flowId = randomBytes(24).toString('base64url');
    this.flows.set(flowId, { purpose: 'login', challenge: options.challenge, expires: Date.now() + CHALLENGE_TTL_MS });
    return { flowId, options };
  }

  async finishLogin(flowId: string, response: AuthenticationResponseJSON): Promise<StoredUser> {
    const flow = this.flows.get(flowId);
    this.flows.delete(flowId);
    if (!flow || flow.purpose !== 'login' || flow.expires < Date.now()) {
      throw new AuthError(400, 'This request has expired - please try again');
    }
    const found = typeof response?.id === 'string' ? this.store.findCredential(response.id) : undefined;
    if (!found) throw new AuthError(401, 'Unknown passkey - it may have been removed');
    const { user, credential } = found;
    if (response.response?.userHandle && response.response.userHandle !== user.handle) {
      throw new AuthError(401, 'Passkey does not belong to this account');
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: flow.challenge,
        expectedOrigin: this.origin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')),
          counter: credential.counter,
          transports: credential.transports as never,
        },
      });
    } catch (error) {
      throw new AuthError(401, `Sign-in failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!verification.verified) throw new AuthError(401, 'Sign-in could not be verified');
    this.store.touchCredential(user.id, credential.id, verification.authenticationInfo.newCounter);
    return user;
  }
}
