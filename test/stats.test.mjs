import assert from "node:assert/strict";
import test from "node:test";
import { Stats, serviceForTool, deviceFromUserAgent } from "../dist/stats.js";

const alice = { userId: "u-alice", name: "alice", client: "Claude Desktop" };
const bob = { userId: "u-bob", name: "bob", client: "OAuth: Claude" };

test("serviceForTool maps prefixes, everything else is core", () => {
  assert.equal(serviceForTool("sonarr_get_series"), "sonarr");
  assert.equal(serviceForTool("bazarr_search"), "bazarr");
  assert.equal(serviceForTool("trash_list_profiles"), "core");
  assert.equal(serviceForTool("search"), "core");
});

test("deviceFromUserAgent keeps only browser and OS", () => {
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iOS");
  assert.equal(deviceFromUserAgent(undefined), "unknown device");
});

async function seeded() {
  const s = new Stats();
  const events = [];
  s.on("call", (e) => events.push(e.phase));
  await s.track("sonarr_get_series", alice, async () => ({ content: [] }));
  await s.track("sonarr_get_queue", bob, async () => ({ content: [], isError: true }));
  await assert.rejects(s.track("radarr_search", alice, async () => { throw new Error("boom"); }));
  return { s, events };
}

test("track counts calls, failures and emits start/end events", async () => {
  const { s, events } = await seeded();
  assert.deepEqual(events, ["start", "end", "start", "end", "start", "end"]);
  const admin = s.snapshot({ id: "u-alice", name: "alice", admin: true });
  assert.equal(admin.totals.calls, 3);
  assert.equal(admin.totals.errors, 2);
  assert.equal(admin.totals.today, 3);
  assert.equal(admin.services.sonarr.calls, 2);
  assert.equal(admin.services.radarr.errors, 1);
  assert.equal(admin.hourly.at(-1), 3);
  assert.deepEqual(admin.callers.map((c) => [c.name, c.calls]), [["alice", 2], ["bob", 1]]);

  // non-admins see no caller list and only their own name in the feed
  const user = s.snapshot({ id: "u-alice", name: "alice", admin: false });
  assert.equal(user.callers.length, 0);
  assert.deepEqual(new Set(user.recent.map((e) => e.caller)), new Set(["alice", "someone"]));
  assert.ok(user.recent.filter((e) => e.caller === "someone").every((e) => !e.callerId && !e.client));
});

test("userSnapshot has personal calls, apps and sign-ins", async () => {
  const { s } = await seeded();
  s.recordLogin("u-alice", "alice", "passkey", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15");
  s.recordLogin("u-alice", "alice", "password", undefined);
  s.recordLoginFailure("u-alice", "alice");
  const me = s.userSnapshot("u-alice", "alice");
  assert.equal(me.totals.calls, 2);
  assert.equal(me.totals.errors, 1);
  assert.equal(me.totals.today, 2);
  assert.equal(me.totals.activeDays, 1);
  assert.deepEqual(me.clients.map((c) => [c.name, c.calls]), [["Claude Desktop", 2]]);
  assert.equal(me.daily.length, 30);
  assert.equal(me.daily.at(-1).calls, 2);
  assert.equal(me.recent.length, 2);
  assert.equal(me.logins.count, 2);
  assert.equal(me.logins.failed, 1);
  assert.deepEqual(me.logins.recent.map((l) => [l.method, l.device]), [["password", "unknown device"], ["passkey", "Safari on macOS"]]);

  s.removeUser("u-alice");
  assert.equal(s.userSnapshot("u-alice", "alice").totals.calls, 0);
  assert.equal(s.snapshot({ name: "x", admin: true }).totals.calls, 3, "global totals are kept");
});
