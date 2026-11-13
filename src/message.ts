import { proto } from "@whiskeysockets/baileys";

export const MEDIA_TYPES = ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/** Unwrap view-once / ephemeral / document-with-caption wrappers. */
export function unwrap(content: proto.IMessage): proto.IMessage {
  let m = content;
  for (let i = 0; i < 5; i++) {
    const inner =
      m.ephemeralMessage?.message ??
      m.viewOnceMessage?.message ??
      m.viewOnceMessageV2?.message ??
      m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  return m;
}

/** The main key of a message content ("extendedTextMessage", "imageMessage", ...). */
export function mainType(content: proto.IMessage): string | undefined {
  return Object.keys(content).find((k) => k !== "messageContextInfo" && (content as Record<string, unknown>)[k]);
}

export const mediaTypeOf = (content: proto.IMessage) => MEDIA_TYPES.find((t) => content[t]);

export interface ChannelInfo {
  jid: string;
  serverMessageId: number;
  name?: string;
  /** Extra forward fields of the original (content type, accessibility text), kept as they were. */
  contentType?: number;
  accessibilityText?: string;
}

/** The channel a forwarded post came from, if it is one. */
export function channelOf(content: proto.IMessage): ChannelInfo | undefined {
  const type = mainType(content);
  const info = type ? (content as any)[type]?.contextInfo?.forwardedNewsletterMessageInfo : undefined;
  if (!info?.newsletterJid) return undefined;
  return {
    jid: info.newsletterJid,
    serverMessageId: Number(info.serverMessageId ?? 0),
    name: info.newsletterName ?? undefined,
    contentType: info.contentType ?? undefined,
    accessibilityText: info.accessibilityText ?? undefined,
  };
}

/** Short text shown in `.status`. */
export function previewOf(content: proto.IMessage): string {
  const media = mediaTypeOf(content);
  const text =
    content.conversation ??
    content.extendedTextMessage?.text ??
    content.imageMessage?.caption ??
    content.videoMessage?.caption ??
    content.documentMessage?.caption ??
    content.documentMessage?.fileName ??
    "";
  const label = media ? `[${media.replace("Message", "")}] ` : "";
  const oneLine = `${label}${text}`.replace(/\s+/g, " ").trim();
  return oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine || "(tanpa teks)";
}

/**
 * The content to send, the way WhatsApp itself forwards a channel post: marked as forwarded
 * from the channel (`forwardOrigin: CHANNELS` and the channel's jid, post id and name), so the
 * recipient sees "Diteruskan dari <saluran>" with the channel's name and a link to it. Quotes and
 * mentions of the chat it was copied from are dropped.
 */
export function forwardContent(content: proto.IMessage, channel?: ChannelInfo): proto.IMessage {
  const copy = proto.Message.decode(proto.Message.encode(unwrap(content)).finish());
  if (copy.conversation) {
    copy.extendedTextMessage = { text: copy.conversation };
    copy.conversation = null;
  }
  delete (copy as any).messageContextInfo;
  const type = mainType(copy);
  if (!type) throw new Error("message has no content");
  const original = (copy as any)[type].contextInfo ?? {};
  (copy as any)[type].contextInfo = {
    isForwarded: true,
    forwardingScore: Math.max(Number(original.forwardingScore ?? 0), 1),
    ...(channel
      ? {
          forwardOrigin: proto.ContextInfo.ForwardOrigin.CHANNELS,
          forwardedNewsletterMessageInfo: {
            newsletterJid: channel.jid,
            serverMessageId: channel.serverMessageId,
            newsletterName: channel.name,
            contentType: channel.contentType ?? proto.ContextInfo.ForwardedNewsletterMessageInfo.ContentType.UPDATE,
            ...(channel.accessibilityText ? { accessibilityText: channel.accessibilityText } : {}),
          },
        }
      : {}),
  };
  return copy;
}
