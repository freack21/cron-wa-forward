/**
 * Schedule keys: "15m", "30m", "1h", "1h30m", "1d". Users may type them loosely
 * ("15 menit", "1 jam", "2j", "90m"); everything is normalised to the canonical key.
 */

export const MINUTE = 60_000;
const UNITS: Record<string, number> = {
  m: 1,
  min: 1,
  mnt: 1,
  menit: 1,
  minute: 1,
  minutes: 1,
  h: 60,
  j: 60,
  jam: 60,
  hour: 60,
  hours: 60,
  d: 1440,
  hari: 1440,
  day: 1440,
  days: 1440,
};

/** Minutes in a loose duration text, or undefined. "1j30m" -> 90, "15" -> undefined. */
export function parseMinutes(text: string): number | undefined {
  const clean = text.toLowerCase().replace(/\s+/g, "");
  if (!clean) return undefined;
  const re = /(\d+)([a-z]+)/g;
  let total = 0;
  let consumed = 0;
  for (let m; (m = re.exec(clean)); ) {
    const unit = UNITS[m[2]];
    if (unit === undefined) return undefined;
    total += Number(m[1]) * unit;
    consumed += m[0].length;
  }
  return consumed === clean.length && total > 0 ? total : undefined;
}

/** 90 -> "1h30m", 1440 -> "1d", 15 -> "15m". */
export function formatKey(minutes: number): string {
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return `${d ? `${d}d` : ""}${h ? `${h}h` : ""}${m ? `${m}m` : ""}`;
}

/** Canonical key of a loose duration, or undefined. */
export const normalizeKey = (text: string) => {
  const minutes = parseMinutes(text);
  return minutes === undefined ? undefined : formatKey(minutes);
};

/** "1h30m" -> "1 jam 30 menit". */
export function describe(key: string): string {
  const minutes = parseMinutes(key) ?? 0;
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  return [d && `${d} hari`, h && `${h} jam`, m && `${m} menit`].filter(Boolean).join(" ") || key;
}

/**
 * Next run after `now`, on a fixed grid: every interval counted from local midnight (so "15m"
 * runs at :00, :15, :30, :45 and "1h" on the hour). Intervals of a day or more count from a
 * fixed local epoch. `tzOffsetMin` is minutes east of UTC.
 */
export function nextRun(key: string, now: number, tzOffsetMin: number): number {
  const ms = (parseMinutes(key) ?? 0) * MINUTE;
  if (ms <= 0) throw new Error(`invalid interval ${key}`);
  const local = now + tzOffsetMin * MINUTE;
  const dayMs = 1440 * MINUTE;
  const origin = ms < dayMs && dayMs % ms === 0 ? Math.floor(local / dayMs) * dayMs : 0;
  const next = origin + (Math.floor((local - origin) / ms) + 1) * ms;
  return next - tzOffsetMin * MINUTE;
}
