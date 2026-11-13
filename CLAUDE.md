# cron-wa-forward

WhatsApp bot that forwards one channel post to chats on a schedule. Configured by its owner with
commands in "Message yourself" (the bot's own chat). TypeScript ESM on
[whatsauto.js](https://github.com/freack21/whatsauto.js).

## Layout

- `src/index.ts` — boot: whatsauto.js client, command chat detection, signals
- `src/commands.ts` — `.menu .status .set .add .del .grup .kirim .jeda .lanjut` (Indonesian replies)
- `src/scheduler.ts` — one timer per schedule on a local clock grid, serialized runs, media refresh, failure reports
- `src/store.ts` — `data/config.json` (`{"msg": ..., "15m": [jids], ...}`, hand-editable) and `data/state.json`
- `src/duration.ts` (interval keys), `src/targets.ts` (numbers, `g<n>`, invite links), `src/message.ts` (forward content)
- `src/wa.ts` — WhatsApp interface; `src/whatsapp.ts` implements it; tests use `FakeWa` (`test/helpers.mjs`)

## Commands

- `npm run typecheck`, `npm test` (builds, then `node:test` on `dist/`), `npm start`
- `npm run check:whatsauto` — compare installed/declared whatsauto.js with the latest npm release

## Rules

- **whatsauto.js must always be the latest release.** Run `npm run check:whatsauto` at the start of every
  session; if newer, `npm install whatsauto.js@latest`, read its CHANGELOG, fix `npm run typecheck`, commit
  `package.json` and `package-lock.json` as `chore(deps): bump whatsauto.js to <version>`.
- Only messages in the bot's own chat are commands. Never log out the session on shutdown.
- **Git identity:** commit as `freack21 <fixri2104@gmail.com>`. No AI co-author trailers.
- **Branches:** descriptive names such as `feat/multiple-messages`.
- **Merging:** `git pull origin <branch>` while on the target branch.
- Commits follow Conventional Commits in English.
