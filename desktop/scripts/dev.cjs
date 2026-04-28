const { spawnSync } = require("node:child_process");

const result = spawnSync(
  process.execPath,
  [
    "./scripts/run-tool.cjs",
    "./node_modules/electron-vite/bin/electron-vite.js",
    "dev",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NO_SANDBOX: process.env.NO_SANDBOX || "1",
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
