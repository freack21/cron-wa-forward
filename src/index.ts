import path from "node:path";
import { AutoWA, setCredentialsDir } from "whatsauto.js";
import { Commands } from "./commands.js";
import { Scheduler } from "./scheduler.js";
import { Store } from "./store.js";
import { createWa } from "./whatsapp.js";

try {
  process.loadEnvFile();
} catch {
  // no .env file
}
process.env.TZ ||= "Asia/Jakarta";

const env = (name: string, fallback: string) => process.env[name]?.trim() || fallback;
const num = (name: string, fallback: number) => Number(process.env[name]) || fallback;

const dataDir = path.resolve(env("DATA_DIR", "data"));
const timeZone = process.env.TZ!;

/** Minutes east of UTC for a time zone, right now. */
function tzOffset(zone: string): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part ?? "");
  return m ? (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
}

setCredentialsDir(path.join(dataDir, "wa_creds"));
const pairingPhone = process.env.PAIRING_PHONE?.trim();
const client = new AutoWA(env("SESSION", "forwarder"), {
  printQR: !pairingPhone,
  ...(pairingPhone ? { phoneNumber: pairingPhone } : {}),
  logging: process.env.WA_LOGGING === "true",
  autoRestart: true,
});

const store = new Store(dataDir);
const ownMessageIds = new Set<string>();
const wa = createWa(client, ownMessageIds);
const scheduler = new Scheduler(store, wa, {
  gapMs: num("FORWARD_GAP_MS", 3000),
  gapJitterMs: num("FORWARD_GAP_JITTER_MS", 3000),
  tzOffsetMin: tzOffset(timeZone),
  mediaMaxAgeMs: num("MEDIA_REFRESH_DAYS", 7) * 86_400_000,
});
const commands = new Commands(store, scheduler, wa, {
  countryCode: env("COUNTRY_CODE", "62"),
  minIntervalMin: num("MIN_INTERVAL_MIN", 5),
  timeZone,
  mediaDir: path.join(dataDir, "media"),
});

const bare = (jid?: string | null) => (jid ?? "").replace(/:\d+@/, "@");

client.on("pairing-code", (code: string) => console.log(`Pairing code: ${code}`));
client.on("connected", () => {
  console.log(`Connected as ${wa.myJids().join(" / ")}. Send ".menu" to yourself (Message yourself) to configure.`);
  scheduler.refresh();
});

// only messages the owner writes in "Message yourself" are commands
client.on("private-message-sent", async (msg) => {
  try {
    const id = msg.key?.id ?? "";
    if (ownMessageIds.delete(id)) return; // the bot's own replies
    const mine = wa.myJids();
    const chat = [msg.key?.remoteJid, msg.key?.remoteJidAlt].map(bare);
    if (!chat.some((jid) => mine.includes(jid))) return;

    const reply = await commands.handle({
      id,
      text: msg.text ?? "",
      content: msg.message ?? undefined,
      quoted: msg.quotedMessage?.message ? { id: msg.quotedMessage.key?.id ?? "quoted", content: msg.quotedMessage.message } : undefined,
    });
    if (reply) await wa.reply(reply);
  } catch (error) {
    console.error("command failed:", error);
    await wa.reply(`❌ Error: ${(error as Error)?.message ?? error}`).catch(() => undefined);
  }
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  // no logout: the session stays linked for the next start
  process.on(signal, () => {
    scheduler.stop();
    process.exit(0);
  });
}

await client.initialize();
