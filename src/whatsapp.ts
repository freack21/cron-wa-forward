import {
  downloadMediaMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  type WAMessage,
  type proto,
} from "@whiskeysockets/baileys";
import type { AutoWA } from "whatsauto.js";
import type { Wa } from "./wa.js";

const bare = (jid: string) => jid.replace(/:\d+@/, "@");

const silent: any = {
  level: "silent",
  child: () => silent,
  trace() {},
  debug() {},
  info() {},
  warn() {},
  error() {},
  fatal() {},
};

/** `Wa` on top of a whatsauto.js client (and its Baileys socket for relaying and media). */
export function createWa(client: AutoWA, ownMessageIds: Set<string>): Wa {
  const sock = () => client.sock;
  const me = () => {
    const ids = client.getBotJids();
    if (!ids) throw new Error("not connected");
    return ids;
  };

  return {
    myJids() {
      const ids = client.getBotJids();
      return ids ? [ids.jid, ids.lid].filter((x): x is string => !!x).map(bare) : [];
    },

    async reply(text) {
      const sent = await sock().sendMessage(bare(me().jid), { text });
      if (sent?.key.id) {
        if (ownMessageIds.size > 500) ownMessageIds.clear();
        ownMessageIds.add(sent.key.id);
      }
    },

    async relay(jid, content) {
      const msg = generateWAMessageFromContent(jid, content, { userJid: sock().user!.id });
      await sock().relayMessage(jid, msg.message!, { messageId: msg.key.id! });
    },

    async download(content: proto.IMessage) {
      const msg = { key: { remoteJid: bare(me().jid), fromMe: true, id: "media" }, message: content } as WAMessage;
      return (await downloadMediaMessage(msg, "buffer", {}, { logger: silent, reuploadRequest: sock().updateMediaMessage })) as Buffer;
    },

    async upload(type, media, old) {
      const kind = type.replace("Message", "") as "image" | "video" | "audio" | "document" | "sticker";
      const prepared = await prepareWAMessageMedia(
        { [kind]: media, mimetype: old.mimetype, fileName: old.fileName, ptt: old.ptt, gifPlayback: old.gifPlayback } as any,
        { upload: sock().waUploadToServer }
      );
      const { caption: _c, contextInfo: _ctx, ...fresh } = ((prepared as any)[type] ?? {}) as Record<string, any>;
      return fresh;
    },

    async groups(opts) {
      return (await client.getGroups({ refresh: !!opts?.refresh })).map((g) => ({ id: g.id, name: g.subject || g.id, size: g.participants?.length ?? 0 }));
    },

    async channelName(jid) {
      try {
        const meta: any = await sock().newsletterMetadata("jid", jid);
        return meta?.thread_metadata?.name?.text ?? meta?.name ?? undefined;
      } catch {
        return undefined;
      }
    },

    async groupOfInvite(code) {
      const info = await sock().groupGetInviteInfo(code);
      return { id: info.id, name: info.subject };
    },
  };
}
