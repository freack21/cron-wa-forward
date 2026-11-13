# cron-wa-forward

WhatsApp bot that forwards a post from your WhatsApp channel to chats and groups on a schedule
(every 15 minutes, every hour, ...). Recipients see it the way WhatsApp shows a forwarded channel
post: *forwarded from <your channel>* with the channel's name and a link to it. You set
everything up by chatting with the bot's own number ("Message yourself"), no server access needed.

> ⚠️ Uses the unofficial WhatsApp Web protocol ([whatsauto.js](https://github.com/freack21/whatsauto.js)
> / Baileys). Sending the same message to many chats often can get the number banned: keep intervals
> long and the chat list short.

## Setup

```bash
npm install
cp .env.example .env
npm run build
npm start          # scan the QR code: WhatsApp > Linked devices > Link a device
```

Or set `PAIRING_PHONE` in `.env` to log in with a pairing code. Run it with pm2 for production:
`pm2 start ecosystem.config.cjs && pm2 save`.

## Usage (chat with yourself on the bot's number)

1. **Pick the message:** forward your channel post into "Message yourself", then send `.set`
   (or reply `.set` to any message).
2. **Schedule it:**

   ```text
   .grup                          list groups: g1, g2, ...
   .fetchgrup                     fetch every group of this number from WhatsApp again (with ids)
   .add 15m 08123456789, g2       every 15 minutes to a number and a group
   .add 1 jam g1 g3 https://chat.whatsapp.com/XXXX
   .del 15m 2                     remove chat #2 of the 15m schedule (numbers from .status)
   .del 15m semua                 remove the whole schedule
   ```

3. **Check:** `.status` (message, schedules, chats, next run), `.kirim 15m` (send now),
   `.jeda` / `.lanjut` (pause / resume), `.menu` (help).

Chats of a schedule are sent **one at a time** with a random pause in between (default 5–10 s).
Change it with `.delay 5-15` (random 5–15 s) or `.delay 10` (exactly 10 s); 2–600 s. Schedules
that are due at the same time wait for each other.

Intervals: `15m`, `30m`, `1h`, `1h30m`, `1d`, also typed as `15 menit`, `2 jam`, `1 hari`; minimum
5 minutes. Runs follow the clock in `TZ` (`15m` = :00, :15, :30, :45; `1d` = midnight). Chats:
numbers in any common shape (`08…`, `+62 812 …`, `62…`), `g<n>` from `.grup`, group invite links,
or ids (`…@g.us`). Failed sends are reported in your chat.

## Config file

`data/config.json` is written by the commands and can be edited by hand (restart after editing):

```json
{
  "msg": "120363xxxxxxxx@newsletter/42",
  "15m": ["6281234567890@s.whatsapp.net", "120363000000000001@g.us"],
  "30m": []
}
```

`msg` identifies the channel post (`<channel>/<post id>`). The post itself, including its media, is
stored in `data/state.json` and `data/media/`; media is uploaded again every 7 days so links don't expire.

## Development

```bash
npm run typecheck
npm test
```
