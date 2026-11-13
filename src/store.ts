import fs from "node:fs";
import path from "node:path";
import { BufferJSON, type proto } from "@whiskeysockets/baileys";
import { normalizeKey, parseMinutes } from "./duration.js";

/**
 * `config.json` keeps the format people edit by hand:
 *   { "msg": "<channel message id>", "15m": ["62812...@s.whatsapp.net", "1203...@g.us"], "30m": [] }
 * Everything else (the stored message itself, pause flag, last runs) lives in `state.json`.
 */
export interface Config {
  msg: string;
  /** schedule key -> chat jids */
  schedules: Record<string, string[]>;
}

export interface StoredMessage {
  /** Message content as received (forwarded channel post), media keys included. */
  content: proto.IMessage;
  /** The channel it came from, shown as "Forwarded from <channel>" on the recipients' side. */
  channel?: { jid: string; serverMessageId: number; name?: string };
  /** Local copy of the media, re-uploaded when WhatsApp's copy may have expired. */
  mediaFile?: string;
  mediaUploadedAt?: number;
  preview: string;
  setAt: number;
}

export interface State {
  paused: boolean;
  message?: StoredMessage;
  lastRun: Record<string, number>;
}

const writeAtomic = (file: string, data: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

export class Store {
  config: Config = { msg: "", schedules: {} };
  state: State = { paused: false, lastRun: {} };

  constructor(public dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  get configFile() {
    return path.join(this.dir, "config.json");
  }
  get stateFile() {
    return path.join(this.dir, "state.json");
  }

  load() {
    if (fs.existsSync(this.configFile)) {
      const raw = JSON.parse(fs.readFileSync(this.configFile, "utf-8")) as Record<string, unknown>;
      const schedules: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (key === "msg") continue;
        const canonical = normalizeKey(key);
        if (!canonical || !Array.isArray(value)) continue; // unknown keys are ignored, not fatal
        schedules[canonical] = [...new Set([...(schedules[canonical] ?? []), ...value.map(String)])];
      }
      this.config = { msg: typeof raw.msg === "string" ? raw.msg : "", schedules };
    }
    if (fs.existsSync(this.stateFile)) {
      this.state = { paused: false, lastRun: {}, ...JSON.parse(fs.readFileSync(this.stateFile, "utf-8"), BufferJSON.reviver) };
    }
  }

  save() {
    const out: Record<string, unknown> = { msg: this.config.msg };
    for (const key of this.sortedKeys()) out[key] = this.config.schedules[key];
    writeAtomic(this.configFile, JSON.stringify(out, null, 2) + "\n");
    writeAtomic(this.stateFile, JSON.stringify(this.state, BufferJSON.replacer, 2));
  }

  /** Schedule keys, shortest interval first. */
  sortedKeys() {
    const minutes = (key: string) => parseMinutes(key) ?? 0;
    return Object.keys(this.config.schedules).sort((a, b) => minutes(a) - minutes(b));
  }

  /** Add chats to a schedule; returns the ones that were new. */
  add(key: string, jids: string[]) {
    const list = (this.config.schedules[key] ??= []);
    const added = jids.filter((j) => !list.includes(j));
    list.push(...added);
    this.save();
    return added;
  }

  /** Remove chats (or the whole schedule when `jids` is "all"); returns what was removed. */
  remove(key: string, jids: string[] | "all") {
    const list = this.config.schedules[key];
    if (!list) return [];
    if (jids === "all") {
      delete this.config.schedules[key];
      delete this.state.lastRun[key];
      this.save();
      return list;
    }
    const removed = list.filter((j) => jids.includes(j));
    this.config.schedules[key] = list.filter((j) => !jids.includes(j));
    this.save();
    return removed;
  }

  setMessage(msgId: string, message: StoredMessage) {
    if (this.state.message?.mediaFile && this.state.message.mediaFile !== message.mediaFile) {
      fs.rmSync(this.state.message.mediaFile, { force: true });
    }
    this.config.msg = msgId;
    this.state.message = message;
    this.save();
  }
}
