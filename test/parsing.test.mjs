import { test } from "node:test";
import assert from "node:assert/strict";
import { describe, formatKey, nextRun, normalizeKey, parseMinutes } from "../dist/duration.js";
import { normalizePhone, parseTarget, prettyJid, splitTargets } from "../dist/targets.js";

test("durations: loose input, canonical keys", () => {
  assert.equal(normalizeKey("15m"), "15m");
  assert.equal(normalizeKey("15 menit"), "15m");
  assert.equal(normalizeKey("90m"), "1h30m");
  assert.equal(normalizeKey("1 jam"), "1h");
  assert.equal(normalizeKey("2j"), "2h");
  assert.equal(normalizeKey("1h30m"), "1h30m");
  assert.equal(normalizeKey("1 hari"), "1d");
  assert.equal(normalizeKey("15"), undefined, "a unit is required");
  assert.equal(normalizeKey("abc"), undefined);
  assert.equal(normalizeKey("15x"), undefined);
  assert.equal(parseMinutes("1d2h"), 1560);
  assert.equal(formatKey(1500), "1d1h");
  assert.equal(describe("1h30m"), "1 jam 30 menit");
});

test("nextRun follows the local clock grid", () => {
  const tz = 420; // WIB
  const at = (s) => Date.parse(`${s}+07:00`);
  assert.equal(nextRun("15m", at("2026-11-13T10:07:00"), tz), at("2026-11-13T10:15:00"));
  assert.equal(nextRun("15m", at("2026-11-13T10:15:00"), tz), at("2026-11-13T10:30:00"), "strictly after now");
  assert.equal(nextRun("1h", at("2026-11-13T10:59:59"), tz), at("2026-11-13T11:00:00"));
  assert.equal(nextRun("1d", at("2026-11-13T10:00:00"), tz), at("2026-11-14T00:00:00"), "daily at local midnight");
  const odd = nextRun("7m", at("2026-11-13T10:00:00"), tz);
  assert.ok(odd > at("2026-11-13T10:00:00") && odd <= at("2026-11-13T10:07:00"));
});

test("phone numbers in every common shape", () => {
  for (const input of ["08123456789", "+62 812-3456-789", "628123456789", "8123456789", "(0812) 3456 789"]) {
    assert.equal(normalizePhone(input, "62"), "628123456789", input);
  }
  assert.equal(normalizePhone("12345", "62"), undefined);
});

test("targets: split, numbers with spaces, groups, links, jids", () => {
  assert.deepEqual(splitTargets("08123456789, g2\n+62 812 3456 7890 g10"), ["08123456789", "g2", "+6281234567890", "g10"]);
  assert.deepEqual(parseTarget("g3", "62"), { kind: "group-index", index: 3 });
  assert.deepEqual(parseTarget("https://chat.whatsapp.com/AbCdEfGhIjKl", "62"), { kind: "invite", code: "AbCdEfGhIjKl" });
  assert.deepEqual(parseTarget("120363000000000001@g.us", "62"), { kind: "jid", jid: "120363000000000001@g.us" });
  assert.deepEqual(parseTarget("0812-3456-789", "62"), { kind: "jid", jid: "628123456789@s.whatsapp.net" });
  assert.equal(parseTarget("halo", "62").kind, "invalid");
  assert.equal(prettyJid("6281234567890@s.whatsapp.net"), "+62 812-3456-7890");
});
