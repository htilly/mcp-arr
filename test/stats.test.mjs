import assert from "node:assert/strict";
import test from "node:test";
import { Stats, serviceForTool } from "../dist/stats.js";

test("serviceForTool maps prefixes, everything else is core", () => {
  assert.equal(serviceForTool("sonarr_get_series"), "sonarr");
  assert.equal(serviceForTool("bazarr_search"), "bazarr");
  assert.equal(serviceForTool("trash_list_profiles"), "core");
  assert.equal(serviceForTool("search"), "core");
});

test("track counts calls, failures and emits start/end events", async () => {
  const s = new Stats();
  const events = [];
  s.on("call", (e) => events.push(e.phase));
  await s.track("sonarr_get_series", "alice", async () => ({ content: [] }));
  await s.track("sonarr_get_queue", "bob", async () => ({ content: [], isError: true }));
  await assert.rejects(s.track("radarr_search", "alice", async () => { throw new Error("boom"); }));
  assert.deepEqual(events, ["start", "end", "start", "end", "start", "end"]);

  const admin = s.snapshot({ name: "alice", admin: true });
  assert.equal(admin.totals.calls, 3);
  assert.equal(admin.totals.errors, 2);
  assert.equal(admin.totals.today, 3);
  assert.equal(admin.services.sonarr.calls, 2);
  assert.equal(admin.services.radarr.errors, 1);
  assert.equal(admin.hourly.at(-1), 3);
  assert.equal(admin.callers.length, 2);

  // non-admins see no caller list and only their own name in the feed
  const user = s.snapshot({ name: "alice", admin: false });
  assert.equal(user.callers.length, 0);
  assert.deepEqual(new Set(user.recent.map((e) => e.caller)), new Set(["alice", "someone"]));
});
