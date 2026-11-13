import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Store } from "../dist/store.js";
import { forwardContent } from "../dist/message.js";
import { channelPost, setup } from "./helpers.mjs";

test("menu and unknown text", async () => {
  const t = setup();
  assert.match(await t.say(".menu"), /\.add 15m/);
  assert.equal(await t.say("halo biasa"), undefined, "plain chat is not a command");
  assert.equal(await t.say(".tidakada"), undefined);
});

test("forward a channel post into the chat, then .set without a reply", async () => {
  const t = setup();
  const offer = await t.commands.handle({ text: "Promo hari ini!", id: "M1", content: channelPost() });
  assert.match(offer, /Ketik \*\.set\*/);
  const reply = await t.say(".set");
  assert.match(reply, /Pesan diatur/);
  assert.match(reply, /Saluran Toko/);
  assert.equal(t.store.config.msg, "120363999999999999@newsletter/42");
  const saved = JSON.parse(fs.readFileSync(path.join(t.dir, "config.json"), "utf-8"));
  assert.equal(saved.msg, "120363999999999999@newsletter/42");
});

test(".set as a reply to any message; media is kept locally", async () => {
  const t = setup();
  assert.match(await t.say(".set"), /Balas \(reply\)/);
  const content = { imageMessage: { caption: "Poster", mimetype: "image/jpeg", url: "https://old" } };
  const reply = await t.say(".set", { quoted: { id: "Q1", content } });
  assert.match(reply, /\[image\] Poster/);
  assert.match(reply, /Detail saluran tidak ditemukan/);
  const m = t.store.state.message;
  assert.equal(fs.readFileSync(m.mediaFile, "utf-8"), "media-bytes");
});

test(".add: numbers, group codes, links, loose interval; config keeps the hand-edited format", async () => {
  const t = setup();
  await t.say(".grup");
  const reply = await t.say(".add 15 menit 0812-3456-789, g1 https://chat.whatsapp.com/AbCdEfGhIjKl halo");
  assert.match(reply, /ditambah 3 chat/);
  assert.match(reply, /Alumni A/, "g1 = first group in name order");
  assert.match(reply, /Dari Link/);
  assert.match(reply, /halo \(bukan nomor/);
  assert.match(reply, /kirim berikutnya/);

  assert.match(await t.say(".add 15m 08123456789"), /sudah ada/);
  assert.match(await t.say(".add 30m g2"), /ditambah 1 chat/);

  const saved = JSON.parse(fs.readFileSync(path.join(t.dir, "config.json"), "utf-8"));
  assert.deepEqual(Object.keys(saved), ["msg", "15m", "30m"]);
  assert.deepEqual(saved["15m"], ["628123456789@s.whatsapp.net", "120363000000000001@g.us", "120363000000000009@g.us"]);
  assert.deepEqual(saved["30m"], ["120363000000000002@g.us"]);
  t.scheduler.stop();
});

test(".add refuses too-short intervals and explains the format", async () => {
  const t = setup();
  assert.match(await t.say(".add 1m 08123456789"), /minimal 5 menit/);
  assert.match(await t.say(".add 08123456789"), /Format/);
  assert.match(await t.say(".add 15m"), /Tujuannya mana/);
  assert.match(await t.say(".add 15m g9"), /tidak ada di daftar/);
});

test(".del by position, by number, and whole schedule", async () => {
  const t = setup();
  await t.say(".add 15m 08111111111 08222222222 08333333333");
  const status = await t.say(".status");
  assert.match(status, /1\. \+62 811-1111-111/);
  assert.match(await t.say(".del 15m 2"), /\+62 822-2222-222/);
  assert.match(await t.say(".del 15m 0811 1111 111"), /Dihapus/);
  assert.deepEqual(t.store.config.schedules["15m"], ["628333333333@s.whatsapp.net"]);
  assert.match(await t.say(".del 15m 9"), /tidak ada nomor urut/);
  assert.match(await t.say(".del 15m semua"), /dihapus/);
  assert.equal(t.store.config.schedules["15m"], undefined);
  t.scheduler.stop();
});

test(".kirim forwards now, marked as forwarded from the channel; failures are listed", async () => {
  const t = setup();
  await t.commands.handle({ text: "x", id: "M1", content: channelPost("Diskon 50%") });
  await t.say(".set");
  await t.say(".add 15m 08111111111, 08222222222");
  t.wa.failFor.add("628222222222@s.whatsapp.net");
  const reply = await t.say(".kirim 15m");
  assert.match(reply, /terkirim ke 1 chat, gagal 1/);
  const sent = t.wa.relayed[0];
  assert.equal(sent.jid, "628111111111@s.whatsapp.net");
  const ctx = sent.content.extendedTextMessage.contextInfo;
  assert.equal(sent.content.extendedTextMessage.text, "Diskon 50%");
  assert.equal(ctx.isForwarded, true);
  assert.equal(ctx.forwardedNewsletterMessageInfo.newsletterName, "Saluran Toko");
  t.scheduler.stop();
});

test(".jeda stops scheduled runs (not .kirim); .lanjut resumes", async () => {
  const t = setup();
  await t.commands.handle({ text: "x", id: "M1", content: channelPost() });
  await t.say(".set");
  await t.say(".add 15m 08111111111");
  await t.say(".jeda");
  assert.match(await t.say(".status"), /Dijeda/);
  assert.equal((await t.scheduler.runNow("15m")).skipped, "dijeda");
  assert.match(await t.say(".kirim 15m"), /terkirim ke 1/);
  assert.match(await t.say(".lanjut"), /berjalan lagi/);
  t.scheduler.stop();
});

test("old media is uploaded again before forwarding", async () => {
  const t = setup();
  await t.say(".set", { quoted: { id: "Q1", content: { imageMessage: { caption: "Poster", mimetype: "image/jpeg", url: "https://old" } } } });
  t.store.state.message.mediaUploadedAt = Date.now() - 8 * 86_400_000;
  await t.say(".add 15m 08111111111");
  await t.say(".kirim 15m");
  assert.deepEqual(t.wa.uploads, [{ type: "imageMessage", media: "media-bytes" }]);
  const img = t.wa.relayed[0].content.imageMessage;
  assert.equal(img.url, "https://new");
  assert.equal(img.caption, "Poster", "caption kept");
  t.scheduler.stop();
});

test("a hand-written config.json in the documented format is loaded", () => {
  const t = setup();
  fs.writeFileSync(
    path.join(t.dir, "config.json"),
    JSON.stringify({ msg: "abc", "15m": ["628111@s.whatsapp.net"], "30 menit": ["1203@g.us"], "1jam": [], junk: 5 })
  );
  const store = new Store(t.dir);
  assert.equal(store.config.msg, "abc");
  assert.deepEqual(store.sortedKeys(), ["15m", "30m", "1h"]);
});

test("forwardContent strips quotes/mentions and wrappers", () => {
  const content = forwardContent(
    { ephemeralMessage: { message: { conversation: "hi" } } },
    { jid: "1@newsletter", serverMessageId: 7, name: "C" }
  );
  assert.equal(content.extendedTextMessage.text, "hi");
  assert.equal(content.extendedTextMessage.contextInfo.forwardedNewsletterMessageInfo.serverMessageId, 7);
  assert.ok(!content.conversation);
});

test("the timer fires a run on schedule", async (ctx) => {
  ctx.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.parse("2026-11-13T10:14:59+07:00") });
  const t = setup();
  await t.commands.handle({ text: "x", id: "M1", content: channelPost() });
  await t.say(".set");
  await t.say(".add 15m 08111111111");
  ctx.mock.timers.tick(1500);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(t.wa.relayed.length, 1);
  t.scheduler.stop();
});

test(".delay: one chat at a time with the configured pause between them", async () => {
  const t = setup();
  assert.match(await t.say(".delay"), /Jeda antar chat sekarang: 0 detik/);
  assert.match(await t.say(".delay 1"), /minimal 2 detik/);
  assert.match(await t.say(".delay 700"), /maksimal 600/);
  assert.match(await t.say(".delay abc"), /Format/);
  assert.match(await t.say(".delay 15-5"), /5–15 detik \(acak\)/);
  assert.deepEqual(t.store.state.delaySec, [5, 15]);
  assert.match(await t.say(".delay 2 detik"), /2 detik\./);
  assert.match(await t.say(".status"), /Jeda antar chat: 2 detik/);

  await t.commands.handle({ text: "x", id: "M1", content: channelPost() });
  await t.say(".set");
  await t.say(".add 15m 08111111111, 08222222222, 08333333333");
  const times = [];
  const relay = t.wa.relay.bind(t.wa);
  t.wa.relay = async (jid, content) => {
    times.push(Date.now());
    return relay(jid, content);
  };
  await t.say(".kirim 15m");
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 1900, `gap ${times[1] - times[0]}ms`);
  assert.ok(times[2] - times[1] >= 1900, `gap ${times[2] - times[1]}ms`);
  t.scheduler.stop();
});

test(".fetchgrup asks WhatsApp again and lists every group with its id", async () => {
  const t = setup();
  const list = await t.say(".fetchgrup");
  assert.deepEqual(t.wa.groupCalls, [true], "refresh, not the cache");
  assert.match(list, /Semua grup nomor ini\* \(2/);
  assert.match(list, /g1\. Alumni A \(12 anggota\)\n\s+120363000000000001@g\.us/);
  assert.match(list, /g2\. Komunitas B/);
  assert.match(await t.say(".fetchgrup alumni"), /Alumni A/);
  const quick = await t.say(".grup");
  assert.equal(t.wa.groupCalls.at(-1), false);
  assert.match(quick, /\.fetchgrup/);
  assert.doesNotMatch(quick, /@g\.us/);
});

test("the forward keeps the channel details, like WhatsApp's own forward", async () => {
  const t = setup();
  const post = channelPost("Info terbaru");
  post.extendedTextMessage.contextInfo.forwardedNewsletterMessageInfo.contentType = 1;
  post.extendedTextMessage.contextInfo.forwardOrigin = 3;
  await t.commands.handle({ text: "x", id: "M1", content: post });
  await t.say(".set");
  await t.say(".add 15m 08111111111");
  await t.say(".kirim 15m");
  const ctx = t.wa.relayed[0].content.extendedTextMessage.contextInfo;
  assert.equal(ctx.isForwarded, true);
  assert.equal(ctx.forwardOrigin, 3, "forwarded from a channel");
  assert.deepEqual(
    { ...ctx.forwardedNewsletterMessageInfo },
    { newsletterJid: "120363999999999999@newsletter", serverMessageId: 42, newsletterName: "Saluran Toko", contentType: 1 }
  );
  assert.equal(ctx.quotedMessage, undefined);
  t.scheduler.stop();
});

test(".set as a reply to a forwarded channel post uses the full copy (a reply's quote has no channel details)", async () => {
  const t = setup();
  await t.commands.handle({ text: "x", id: "POST1", content: channelPost("Promo") });
  await t.commands.handle({ text: "x", id: "POST2", content: channelPost("Lain") });
  const trimmed = { extendedTextMessage: { text: "Promo" } }; // what the quote carries
  const reply = await t.say(".set", { quoted: { id: "POST1", content: trimmed } });
  assert.match(reply, /Promo/);
  assert.match(reply, /Saluran Toko/);
  assert.equal(t.store.state.message.channel.jid, "120363999999999999@newsletter");
});

test("a channel post without a name gets it from the channel's metadata", async () => {
  const t = setup();
  const post = channelPost("Tanpa nama");
  const info = post.extendedTextMessage.contextInfo.forwardedNewsletterMessageInfo;
  info.newsletterJid = "120363888888888888@newsletter";
  delete info.newsletterName;
  await t.commands.handle({ text: "x", id: "M9", content: post });
  assert.match(await t.say(".set"), /Saluran Dari Metadata/);
  assert.equal(t.store.state.message.channel.name, "Saluran Dari Metadata");
});
