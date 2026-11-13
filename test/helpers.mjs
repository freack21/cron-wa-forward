import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Commands } from "../dist/commands.js";
import { Scheduler } from "../dist/scheduler.js";
import { Store } from "../dist/store.js";

export const ME = "6281111111111@s.whatsapp.net";

export class FakeWa {
  replies = [];
  relayed = [];
  uploads = [];
  failFor = new Set();
  groupsList = [
    { id: "120363000000000002@g.us", name: "Komunitas B", size: 40 },
    { id: "120363000000000001@g.us", name: "Alumni A", size: 12 },
  ];
  myJids() {
    return [ME, "100000000000001@lid"];
  }
  async reply(text) {
    this.replies.push(text);
  }
  async relay(jid, content) {
    if (this.failFor.has(jid)) throw new Error("not-authorized");
    this.relayed.push({ jid, content });
  }
  async download() {
    return Buffer.from("media-bytes");
  }
  async upload(type, media) {
    this.uploads.push({ type, media: media.toString() });
    return { url: "https://new", mediaKey: Buffer.from("newkey"), directPath: "/new" };
  }
  groupCalls = [];
  async groups(opts = {}) {
    this.groupCalls.push(!!opts.refresh);
    return this.groupsList.map((g) => ({ ...g }));
  }
  async channelName(jid) {
    return jid === "120363888888888888@newsletter" ? "Saluran Dari Metadata" : undefined;
  }
  async groupOfInvite(code) {
    if (code === "AbCdEfGhIjKl") return { id: "120363000000000009@g.us", name: "Dari Link" };
    throw new Error("not found");
  }
}

export function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cwf-"));
  const store = new Store(dir);
  const wa = new FakeWa();
  const scheduler = new Scheduler(store, wa, { gapMs: 0, gapJitterMs: 0, tzOffsetMin: 420, mediaMaxAgeMs: 7 * 86_400_000 }, () => {});
  const commands = new Commands(store, scheduler, wa, {
    countryCode: "62",
    minIntervalMin: 5,
    timeZone: "Asia/Jakarta",
    mediaDir: path.join(dir, "media"),
  });
  const say = (text, extra = {}) => commands.handle({ text, ...extra });
  return { dir, store, wa, scheduler, commands, say };
}

/** A channel post as it looks after being forwarded into the bot's own chat. */
export function channelPost(text = "Promo hari ini!", extra = {}) {
  return {
    extendedTextMessage: {
      text,
      contextInfo: {
        isForwarded: true,
        forwardingScore: 1,
        forwardedNewsletterMessageInfo: { newsletterJid: "120363999999999999@newsletter", serverMessageId: 42, newsletterName: "Saluran Toko" },
      },
    },
    ...extra,
  };
}
