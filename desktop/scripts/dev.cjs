const { spawnSync } = require("node:child_process");

const electronCliArgs = JSON.parse(process.env.ELECTRON_CLI_ARGS || "[]");
const gpuSafeArgs = ["--disable-gpu", "--disable-gpu-compositing", "--in-process-gpu"];

for (const arg of gpuSafeArgs) {
  if (!electronCliArgs.includes(arg)) {
    electronCliArgs.push(arg);
  }
}

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
      ELECTRON_CLI_ARGS: JSON.stringify(electronCliArgs),
    },
  },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
