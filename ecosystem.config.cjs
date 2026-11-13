// pm2 start ecosystem.config.cjs && pm2 save
module.exports = {
  apps: [
    {
      name: "cron-wa-forward",
      script: "dist/index.js",
      cwd: __dirname,
      instances: 1, // one WhatsApp session: never cluster mode
      exec_mode: "fork",
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
