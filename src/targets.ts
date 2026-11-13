/**
 * Chats are typed the way people write them: "0812-3456-7890", "+62 812 3456 7890", "g2"
 * (number 2 of the last `.grup` list), a group invite link, or a raw jid. Several targets are
 * separated by commas, spaces or new lines.
 */

export type Target =
  | { kind: "jid"; jid: string }
  | { kind: "group-index"; index: number }
  | { kind: "invite"; code: string }
  | { kind: "invalid"; text: string; reason: string };

const digitsOf = (s: string) => s.replace(/\D/g, "");
/** A fragment that can start a phone number: "+62", "0812", "62812", "812". */
const phoneStart = (s: string) => /^(\+|\(?0|62|8)[\d\-().]+$/.test(s) && digitsOf(s).length >= 2;
const phonePart = (s: string) => /^[\d\-().]+$/.test(s);

export function splitTargets(text: string): string[] {
  const out: string[] = [];
  for (const segment of text.split(/[,;\n]+/)) {
    const words = segment.split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      let token = words[i];
      // a phone number may be written with spaces ("+62 812 3456 7890"): join its groups
      if (phoneStart(token)) {
        while (i + 1 < words.length && digitsOf(token).length < 10 && phonePart(words[i + 1]) && digitsOf(token + words[i + 1]).length <= 15) {
          token += words[++i];
        }
      }
      out.push(token);
    }
  }
  return out;
}

/** "0812..." -> "62812...", "+62812..." -> "62812...", "812..." -> "62812...". */
export function normalizePhone(text: string, countryCode: string): string | undefined {
  let digits = text.replace(/[\s\-().+]/g, "");
  if (!/^\d+$/.test(digits)) return undefined;
  if (digits.startsWith("0")) digits = countryCode + digits.slice(1);
  else if (digits.startsWith("8") && countryCode === "62") digits = countryCode + digits;
  return digits.length >= 10 && digits.length <= 15 ? digits : undefined;
}

export function parseTarget(token: string, countryCode: string): Target {
  const t = token.trim();
  const invite = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9]{10,})/.exec(t);
  if (invite) return { kind: "invite", code: invite[1] };
  const group = /^g(\d{1,4})$/i.exec(t);
  if (group) return { kind: "group-index", index: Number(group[1]) };
  if (/^\d+(-\d+)?@g\.us$/.test(t)) return { kind: "jid", jid: t };
  if (/^\d+@s\.whatsapp\.net$/.test(t)) return { kind: "jid", jid: t };
  const phone = normalizePhone(t, countryCode);
  if (phone) return { kind: "jid", jid: `${phone}@s.whatsapp.net` };
  return { kind: "invalid", text: t, reason: "bukan nomor, g<nomor grup>, link grup, atau ID chat" };
}

/** "6281234567890@s.whatsapp.net" -> "+62 812-3456-7890"; groups keep their id. */
export function prettyJid(jid: string): string {
  const m = /^(\d+)@s\.whatsapp\.net$/.exec(jid);
  if (!m) return jid;
  const d = m[1];
  return d.startsWith("62") ? `+62 ${d.slice(2, 5)}-${d.slice(5, 9)}-${d.slice(9)}` : `+${d}`;
}
