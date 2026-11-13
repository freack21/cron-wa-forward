import fs from "node:fs";
import { MINUTE, describe, nextRun } from "./duration.js";
import { forwardContent, mediaTypeOf } from "./message.js";
import type { Store } from "./store.js";
import { prettyJid } from "./targets.js";
import type { Wa } from "./wa.js";

export interface SchedulerOptions {
  /** Pause between two chats of one run, plus a random extra up to `gapJitterMs` (anti-spam). */
  gapMs: number;
  gapJitterMs: number;
  /** Minutes east of UTC for the schedule grid (Asia/Jakarta = 420). */
  tzOffsetMin: number;
  /** Re-upload the stored media when WhatsApp's copy is older than this. */
  mediaMaxAgeMs: number;
}

export interface RunResult {
  key: string;
  sent: string[];
  failed: { jid: string; error: string }[];
  skipped?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One timer per schedule; runs are serialized so two schedules never send at the same time. */
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();
  private next = new Map<string, number>();
  private chain: Promise<unknown> = Promise.resolve();
  private running = new Set<string>();
  private stopped = false;

  constructor(
    private store: Store,
    private wa: Wa,
    private opts: SchedulerOptions,
    private log: (msg: string) => void = console.log
  ) {}

  /** (Re)plan every schedule; call after the config changed. */
  refresh() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.next.clear();
    if (this.stopped) return;
    for (const key of this.store.sortedKeys()) this.plan(key);
  }

  stop() {
    this.stopped = true;
    this.refresh();
  }

  nextRunOf(key: string) {
    return this.next.get(key);
  }

  private plan(key: string) {
    const at = nextRun(key, Date.now(), this.opts.tzOffsetMin);
    this.next.set(key, at);
    // setTimeout can't wait longer than ~24.8 days; re-plan in steps
    const wait = Math.min(at - Date.now(), 24 * 60 * MINUTE);
    const timer = setTimeout(() => {
      if (Date.now() + 1000 < at) return this.plan(key);
      this.plan(key);
      void this.runNow(key).then((r) => this.report(r));
    }, Math.max(wait, 0));
    timer.unref?.();
    this.timers.set(key, timer);
  }

  /** Forward to every chat of a schedule now (also used by `.kirim`). */
  runNow(key: string, opts: { force?: boolean } = {}): Promise<RunResult> {
    const run = this.chain.then(() => this.run(key, opts));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async run(key: string, { force = false }: { force?: boolean }): Promise<RunResult> {
    const result: RunResult = { key, sent: [], failed: [] };
    const chats = this.store.config.schedules[key] ?? [];
    const message = this.store.state.message;
    if (!message) return { ...result, skipped: "belum ada pesan (balas pesan saluran dengan .set)" };
    if (this.store.state.paused && !force) return { ...result, skipped: "dijeda" };
    if (!chats.length) return { ...result, skipped: "belum ada chat" };
    if (this.running.has(key)) return { ...result, skipped: "putaran sebelumnya belum selesai" };

    this.running.add(key);
    try {
      await this.refreshMedia().catch((error) => this.log(`[media] re-upload failed: ${error?.message ?? error}`));
      const content = forwardContent(this.store.state.message!.content, message.channel);
      for (const [i, jid] of chats.entries()) {
        if (i > 0) await sleep(this.opts.gapMs + Math.floor(Math.random() * (this.opts.gapJitterMs + 1)));
        try {
          await this.wa.relay(jid, content);
          result.sent.push(jid);
        } catch (error) {
          result.failed.push({ jid, error: String((error as Error)?.message ?? error).slice(0, 120) });
        }
      }
      this.store.state.lastRun[key] = Date.now();
      this.store.save();
      this.log(`[${key}] sent ${result.sent.length}, failed ${result.failed.length}`);
      return result;
    } finally {
      this.running.delete(key);
    }
  }

  /** Media links in a forwarded message expire: upload the local copy again when it is old. */
  private async refreshMedia() {
    const message = this.store.state.message;
    if (!message?.mediaFile || Date.now() - (message.mediaUploadedAt ?? 0) < this.opts.mediaMaxAgeMs) return;
    const type = mediaTypeOf(message.content);
    if (!type || !fs.existsSync(message.mediaFile)) return;
    const old = message.content[type] as Record<string, any>;
    const fresh = await this.wa.upload(type, fs.readFileSync(message.mediaFile), old);
    message.content = { ...message.content, [type]: { ...old, ...fresh } };
    message.mediaUploadedAt = Date.now();
    this.store.save();
    this.log("[media] re-uploaded");
  }

  /** Scheduled runs only tell the owner about problems. */
  private async report(r: RunResult) {
    if (!r.failed.length) return;
    const lines = r.failed.slice(0, 10).map((f) => `• ${prettyJid(f.jid)}: ${f.error}`);
    const more = r.failed.length > 10 ? `\n…dan ${r.failed.length - 10} lagi` : "";
    await this.wa
      .reply(`⚠️ Jadwal *${describe(r.key)}*: gagal ke ${r.failed.length} chat (terkirim ${r.sent.length}).\n${lines.join("\n")}${more}`)
      .catch(() => undefined);
  }
}
