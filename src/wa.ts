import type { proto } from "@whiskeysockets/baileys";

/** What the bot needs from WhatsApp; `src/whatsapp.ts` implements it, tests use a fake. */
export interface Wa {
  /** The bot's own ids (phone-number jid and @lid), bare (no device suffix). */
  myJids(): string[];
  /** Write into the bot's own chat (the command chat). */
  reply(text: string): Promise<void>;
  /** Send a prepared message content to a chat. */
  relay(jid: string, content: proto.IMessage): Promise<void>;
  /** Download the media of a message content. */
  download(content: proto.IMessage): Promise<Buffer>;
  /** Upload media again; returns the new media fields (url, mediaKey, directPath, ...). */
  upload(type: string, media: Buffer, old: Record<string, any>): Promise<Record<string, any>>;
  groups(): Promise<{ id: string; name: string; size: number }[]>;
  /** The group of an invite link (the bot must already be a member to send there). */
  groupOfInvite(code: string): Promise<{ id: string; name: string }>;
}
