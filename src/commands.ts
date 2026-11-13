import fs from "node:fs";
import path from "node:path";
import type { proto } from "@whiskeysockets/baileys";
import { describe, normalizeKey, parseMinutes } from "./duration.js";
import { channelOf, mediaTypeOf, previewOf, unwrap } from "./message.js";
import type { Scheduler } from "./scheduler.js";
import type { Store } from "./store.js";
import { parseTarget, prettyJid, splitTargets } from "./targets.js";
import type { Wa } from "./wa.js";

export interface CommandOptions {
  countryCode: string;
  /** Shortest allowed interval in minutes (anti-ban). */
  minIntervalMin: number;
  timeZone: string;
  mediaDir: string;
}

export interface Incoming {
  text: string;
  /** The message this one replies to. */
  quoted?: { id: string; content: proto.IMessage };
}

const PREFIX = /^[.!/#]/;
const ALL = ["semua", "all", "*"];

/** Commands typed in the bot's own chat ("Message yourself"). */
export class Commands {
  private groupList: { id: string; name: string; size: number }[] = [];
  private groupNames = new Map<string, string>();
  private groupNamesAt = 0;
  /** The last channel post forwarded into the command chat (used by `.set` without a reply). */
  private lastChannelPost?: { id: string; content: proto.IMessage };
  /**
   * Channel posts seen in the command chat, by message id. A reply only carries a trimmed copy of
   * the message it quotes (without the channel details), so `.set` as a reply uses this full copy.
   */
  private recentPosts = new Map<string, proto.IMessage>();

  constructor(
    private store: Store,
    private scheduler: Scheduler,
    private wa: Wa,
    private opts: CommandOptions
  ) {}

  /** Handle one message of the command chat; returns the reply, or undefined for non-commands. */
  async handle(msg: Incoming & { id?: string; content?: proto.IMessage }): Promise<string | undefined> {
    const text = msg.text.trim();
    if (!PREFIX.test(text)) {
      // a channel post forwarded into this chat: offer it
      if (msg.content && msg.id && channelOf(unwrap(msg.content))) {
        this.lastChannelPost = { id: msg.id, content: msg.content };
        this.recentPosts.set(msg.id, msg.content);
        if (this.recentPosts.size > 50) this.recentPosts.delete(this.recentPosts.keys().next().value!);
        return `📌 Postingan saluran diterima: _${previewOf(unwrap(msg.content))}_\nKetik *.set* untuk menjadikannya pesan yang diteruskan.`;
      }
      return undefined;
    }
    const [word, ...rest] = text.slice(1).split(/\s+/);
    const args = rest.join(" ").trim();
    switch (word.toLowerCase()) {
      case "menu":
      case "help":
      case "bantuan":
        return this.menu();
      case "status":
      case "cek":
      case "list":
        return this.status();
      case "set":
      case "pesan":
        return this.set(msg.quoted);
      case "add":
      case "tambah":
        return this.add(args);
      case "del":
      case "hapus":
      case "rm":
        return this.remove(args);
      case "grup":
      case "group":
      case "groups":
        return this.groups(args);
      case "fetchgrup":
      case "ambilgrup":
      case "refreshgrup":
      case "fetchgroups":
        return this.groups(args, true);
      case "kirim":
      case "test":
      case "send":
        return this.sendNow(args);
      case "delay":
      case "jarak":
        return this.delay(args);
      case "jeda":
      case "pause":
        this.store.state.paused = true;
        this.store.save();
        return "⏸️ Semua jadwal dijeda. Ketik *.lanjut* untuk menjalankan lagi.";
      case "lanjut":
      case "resume":
        this.store.state.paused = false;
        this.store.save();
        return "▶️ Jadwal berjalan lagi.\n\n" + this.schedulesText();
      default:
        return undefined; // other prefixed text is left alone
    }
  }

  private menu() {
    return [
      "*🤖 Forward Saluran Terjadwal*",
      "",
      "*1. Pilih pesan*",
      "Teruskan postingan saluranmu ke chat ini, lalu ketik *.set* (atau balas pesan apa pun dengan *.set*).",
      "",
      "*2. Atur jadwal & tujuan*",
      "*.add 15m 08123456789, g2* — kirim tiap 15 menit ke nomor & grup (satu chat hanya di satu jadwal: kalau sudah ada di jadwal lain, dipindah ke sini)",
      "*.grup* — daftar grup (pakai g1, g2, ... di .add). *.grup kata* untuk mencari",
      "*.fetchgrup* — ambil ulang semua grup nomor ini dari WhatsApp (lengkap dengan ID)",
      "*.del 15m 2* — hapus chat nomor 2 dari jadwal 15m (lihat .status)",
      "*.del 15m semua* — hapus jadwal 15m",
      "",
      "*3. Pantau*",
      "*.status* — pesan, jadwal, tujuan, waktu kirim berikutnya",
      "*.kirim 15m* — kirim sekarang untuk mencoba",
      "*.jeda* / *.lanjut* — hentikan / jalankan semua jadwal",
      "*.delay 5-15* — jeda acak 5–15 detik antar chat (*.delay 10* = tepat 10 detik)",
      "",
      `Interval: 15m, 30m, 1h (jam), 1h30m, 1d (hari); boleh "15 menit", "2 jam". Minimal ${describe(`${this.opts.minIntervalMin}m`)}.`,
      "Tujuan: nomor (08…, +62…, 62…), g<nomor> dari .grup, link grup chat.whatsapp.com/…, atau ID …@g.us. Pisahkan dengan koma/spasi/baris baru.",
    ].join("\n");
  }

  private fmtTime(ms: number) {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: this.opts.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
    }).format(ms);
  }

  /** "g3 · Nama Grup" for groups (the code of the last .grup list), "+62 812-…" for numbers. */
  private async nameOf(jid: string) {
    if (!jid.endsWith("@g.us")) return prettyJid(jid);
    if (!this.groupList.length || Date.now() - this.groupNamesAt > 10 * 60_000) {
      await this.loadGroups().catch(() => undefined); // names are cosmetic
    }
    const index = this.groupList.findIndex((g) => g.id === jid);
    const name = this.groupNames.get(jid) ?? jid;
    return index >= 0 ? `*g${index + 1}* · ${name}` : `${name} _(bukan anggota lagi)_`;
  }

  private schedulesText(names?: Map<string, string>) {
    const keys = this.store.sortedKeys();
    if (!keys.length) return "Belum ada jadwal. Contoh: *.add 15m 08123456789, g1*";
    return keys
      .map((key) => {
        const chats = this.store.config.schedules[key];
        const next = this.scheduler.nextRunOf(key);
        const head = `⏱️ *Tiap ${describe(key)}* (\`${key}\`) — ${chats.length} chat${
          next && !this.store.state.paused ? `, berikutnya ${this.fmtTime(next)}` : ""
        }`;
        const list = chats.map((jid, i) => `   ${i + 1}. ${names?.get(jid) ?? prettyJid(jid)}`);
        return [head, ...(list.length ? list : ["   (kosong)"])].join("\n");
      })
      .join("\n\n");
  }

  private async status() {
    const m = this.store.state.message;
    const names = new Map<string, string>();
    for (const jid of Object.values(this.store.config.schedules).flat()) names.set(jid, await this.nameOf(jid));
    return [
      "*📋 Status*",
      m
        ? `📨 Pesan: _${m.preview}_${m.channel ? `\n   dari saluran ${m.channel.name ?? m.channel.jid}` : ""}`
        : "📨 Pesan: belum diatur — teruskan postingan saluran ke chat ini lalu ketik *.set*",
      this.store.state.paused ? "⏸️ *Dijeda* — ketik *.lanjut*" : "▶️ Berjalan",
      `🐢 Jeda antar chat: ${this.delayText()} (ubah: *.delay 5-15*)`,
      "",
      this.schedulesText(names),
      Object.values(this.store.config.schedules).some((l) => l.some((j) => j.endsWith("@g.us")))
        ? "\nKode *g* sama dengan daftar *.grup*; pakai juga untuk hapus, contoh: *.del 10m g3*"
        : "",
    ]
      .join("\n")
      .trimEnd();
  }

  private async set(quoted?: Incoming["quoted"]) {
    const full = quoted && this.recentPosts.get(quoted.id);
    const source = quoted ? { id: quoted.id, content: full ?? quoted.content } : this.lastChannelPost;
    if (!source) {
      return "Balas (reply) pesan yang mau diteruskan dengan *.set*, atau teruskan dulu postingan saluranmu ke chat ini lalu ketik *.set*.";
    }
    const content = unwrap(source.content);
    const channel = channelOf(content);
    if (channel && !channel.name) channel.name = await this.wa.channelName(channel.jid).catch(() => undefined);
    const type = mediaTypeOf(content);
    let mediaFile: string | undefined;
    if (type) {
      try {
        const media = await this.wa.download(content);
        fs.mkdirSync(this.opts.mediaDir, { recursive: true });
        mediaFile = path.join(this.opts.mediaDir, `${source.id.replace(/[^A-Za-z0-9_-]/g, "")}.bin`);
        fs.writeFileSync(mediaFile, media);
      } catch {
        return "❌ Media pesan itu tidak bisa diunduh (mungkin sudah kedaluwarsa). Teruskan lagi postingannya ke chat ini lalu *.set*.";
      }
    }
    this.store.setMessage(channel ? `${channel.jid}/${channel.serverMessageId}` : source.id, {
      content,
      channel,
      mediaFile,
      mediaUploadedAt: type ? Date.now() : undefined,
      preview: previewOf(content),
      setAt: Date.now(),
    });
    this.lastChannelPost = undefined;
    return [
      `✅ Pesan diatur: _${previewOf(content)}_`,
      channel ? `Penerima melihatnya sebagai diteruskan dari saluran *${channel.name ?? channel.jid}*.` : "ℹ️ Detail saluran tidak ditemukan, jadi dikirim sebagai pesan diteruskan biasa. Kalau ini postingan saluran, teruskan ulang postingannya ke chat ini lalu ketik *.set* (tanpa reply).",
      this.store.sortedKeys().length ? "" : "\nLanjut atur jadwal, contoh: *.add 15m 08123456789, g1*",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** "15m rest" or "15 menit rest" -> key + rest. */
  private splitInterval(args: string): { key?: string; rest: string } {
    const words = args.split(/\s+/).filter(Boolean);
    for (const take of [2, 1]) {
      if (words.length < take) continue;
      const key = normalizeKey(words.slice(0, take).join(""));
      if (key) return { key, rest: words.slice(take).join(" ") };
    }
    return { rest: args };
  }

  private async resolveTargets(rest: string) {
    const jids: string[] = [];
    const errors: string[] = [];
    for (const token of splitTargets(rest)) {
      const t = parseTarget(token, this.opts.countryCode);
      if (t.kind === "jid") jids.push(t.jid);
      else if (t.kind === "group-index") {
        if (!this.groupList.length) await this.loadGroups();
        const g = this.groupList[t.index - 1];
        if (g) jids.push(g.id);
        else errors.push(`g${t.index} (tidak ada di daftar .grup)`);
      } else if (t.kind === "invite") {
        try {
          const g = await this.wa.groupOfInvite(t.code);
          this.groupNames.set(g.id, g.name);
          jids.push(g.id);
        } catch {
          errors.push(`${token} (link grup tidak valid)`);
        }
      } else errors.push(`${t.text} (${t.reason})`);
    }
    return { jids: [...new Set(jids)], errors };
  }

  private async add(args: string) {
    const { key, rest } = this.splitInterval(args);
    if (!key) return "Format: *.add <interval> <tujuan>*\nContoh: *.add 15m 08123456789, g2* atau *.add 1 jam g1 g3*";
    if ((parseMinutes(key) ?? 0) < this.opts.minIntervalMin) {
      return `❌ Interval minimal ${describe(`${this.opts.minIntervalMin}m`)} supaya nomor tidak dianggap spam.`;
    }
    if (!rest) return `Tujuannya mana? Contoh: *.add ${key} 08123456789, g2* (lihat *.grup* untuk g1, g2, ...)`;
    const { jids, errors } = await this.resolveTargets(rest);
    if (!jids.length) return `❌ Tidak ada tujuan yang dikenali:\n${errors.map((e) => `• ${e}`).join("\n")}`;
    const added = this.store.add(key, jids);
    this.scheduler.refresh();
    const lines = await Promise.all(
      added.map(async (a) => `• ${await this.nameOf(a.jid)}${a.from ? ` (pindah dari ${a.from}, di sana dihapus)` : ""}`)
    );
    const moved = added.filter((a) => a.from).length;
    const total = this.store.config.schedules[key].length;
    const next = this.scheduler.nextRunOf(key);
    return [
      added.length
        ? `✅ Tiap *${describe(key)}*: ${moved === added.length ? `${moved} chat dipindah ke sini` : `ditambah ${added.length} chat${moved ? ` (${moved} dipindah)` : ""}`}\n${lines.join("\n")}`
        : `Semua tujuan itu sudah ada di jadwal ${key}.`,
      jids.length > added.length && added.length ? `(${jids.length - added.length} sudah ada sebelumnya)` : "",
      errors.length ? `⚠️ Dilewati:\n${errors.map((e) => `• ${e}`).join("\n")}` : "",
      `Total ${total} chat${next ? `, kirim berikutnya ${this.fmtTime(next)}` : ""}.`,
      this.store.state.message ? "" : "ℹ️ Pesan belum diatur: teruskan postingan saluran ke chat ini lalu *.set*.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  private async remove(args: string) {
    const { key, rest } = this.splitInterval(args);
    if (!key) return "Format: *.del <interval> <nomor urut / tujuan / semua>*\nContoh: *.del 15m 2* atau *.del 15m semua*";
    const chats = this.store.config.schedules[key];
    if (!chats) return `Tidak ada jadwal ${key}. Lihat *.status*.`;
    if (!rest) return `Yang dihapus apa? Contoh: *.del ${key} 2* (nomor urut di .status) atau *.del ${key} semua*`;
    if (ALL.includes(rest.toLowerCase())) {
      this.store.remove(key, "all");
      this.scheduler.refresh();
      return `🗑️ Jadwal tiap *${describe(key)}* dihapus (${chats.length} chat).`;
    }
    const jids: string[] = [];
    const errors: string[] = [];
    const others: string[] = [];
    for (const token of splitTargets(rest)) {
      // small numbers are positions in the .status list
      if (/^\d{1,3}$/.test(token)) {
        const jid = chats[Number(token) - 1];
        if (jid) jids.push(jid);
        else errors.push(`${token} (tidak ada nomor urut itu)`);
      } else others.push(token);
    }
    if (others.length) {
      const resolved = await this.resolveTargets(others.join(" "));
      jids.push(...resolved.jids);
      errors.push(...resolved.errors);
    }
    const removed = this.store.remove(key, jids);
    const names = await Promise.all(removed.map((j) => this.nameOf(j)));
    const missing = jids.filter((j) => !removed.includes(j));
    return [
      removed.length ? `🗑️ Dihapus dari jadwal ${key}:\n${names.map((n) => `• ${n}`).join("\n")}` : "Tidak ada yang dihapus.",
      missing.length ? `(${missing.length} tujuan tidak ada di jadwal ini)` : "",
      errors.length ? `⚠️ ${errors.join(", ")}` : "",
      `Sisa ${this.store.config.schedules[key].length} chat.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  private delayText() {
    const [min, max] = this.scheduler.delayRange().map((ms) => Math.round(ms / 100) / 10);
    return min === max ? `${min} detik` : `${min}–${max} detik (acak)`;
  }

  private delay(args: string) {
    if (!args) return `🐢 Jeda antar chat sekarang: ${this.delayText()}.\nUbah: *.delay 5-15* (acak 5–15 detik) atau *.delay 10* (tepat 10 detik).`;
    const m = /^(\d+(?:[.,]\d+)?)\s*(?:-|–|sampai|s\/d|to)?\s*(\d+(?:[.,]\d+)?)?\s*(?:s|d|dtk|detik)?$/i.exec(args.trim());
    const num = (x?: string) => (x === undefined ? undefined : Number(x.replace(",", ".")));
    const a = num(m?.[1]);
    const b = num(m?.[2]) ?? a;
    if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) {
      return "Format: *.delay 5-15* (acak 5–15 detik) atau *.delay 10* (tepat 10 detik).";
    }
    const [min, max] = [Math.min(a, b), Math.max(a, b)];
    if (min < 2) return "❌ Jeda minimal 2 detik antar chat supaya tidak dianggap spam.";
    if (max > 600) return "❌ Jeda maksimal 600 detik (10 menit).";
    this.store.state.delaySec = [min, max];
    this.store.save();
    const chats = Math.max(0, ...Object.values(this.store.config.schedules).map((l) => l.length));
    const longest = chats > 1 ? `\nJadwal terbesar (${chats} chat) selesai dalam ±${Math.ceil(((chats - 1) * max) / 60)} menit.` : "";
    return `✅ Jeda antar chat: ${this.delayText()}. Pesan dikirim satu per satu.${longest}`;
  }

  private async loadGroups(refresh = false) {
    const groups = await this.wa.groups({ refresh });
    this.groupList = groups.sort((a, b) => a.name.localeCompare(b.name, "id"));
    for (const g of groups) this.groupNames.set(g.id, g.name);
    this.groupNamesAt = Date.now();
  }

  private async groups(filter: string, refresh = false) {
    await this.loadGroups(refresh);
    if (!this.groupList.length) return "Nomor ini belum masuk grup mana pun.";
    const needle = filter.toLowerCase();
    const rows = this.groupList
      .map((g, i) => ({ g, i }))
      .filter(({ g }) => !needle || g.name.toLowerCase().includes(needle))
      .map(({ g, i }) => `g${i + 1}. ${g.name} (${g.size} anggota)${refresh ? `\n      ${g.id}` : ""}`);
    if (!rows.length) return `Tidak ada grup yang namanya memuat "${filter}".`;
    const title = refresh ? `*👥 Semua grup nomor ini* (${rows.length}, baru diambil dari WhatsApp)` : `*👥 Grup* (${rows.length})`;
    return `${title}\n${rows.join("\n")}\n\nPakai kodenya, contoh: *.add 15m g1 g3*${refresh ? "" : "\nGrup baru belum muncul? *.fetchgrup*"}`;
  }

  private async sendNow(args: string) {
    const { key } = this.splitInterval(args);
    if (!key || !this.store.config.schedules[key]) {
      const keys = this.store.sortedKeys();
      return keys.length ? `Jadwal mana? Contoh: *.kirim ${keys[0]}*. Ada: ${keys.join(", ")}` : "Belum ada jadwal.";
    }
    const r = await this.scheduler.runNow(key, { force: true });
    if (r.skipped) return `⏭️ Tidak dikirim: ${r.skipped}.`;
    const failed = await Promise.all(r.failed.map(async (f) => `• ${await this.nameOf(f.jid)}: ${f.error}`));
    return [`📤 Jadwal ${key}: terkirim ke ${r.sent.length} chat${r.failed.length ? `, gagal ${r.failed.length}` : ""}.`, ...failed].join("\n");
  }
}
