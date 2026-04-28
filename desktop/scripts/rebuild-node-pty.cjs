const { spawnSync } = require("node:child_process");

const cwd = process.cwd();
const rebuildCommand =
  "node .\\node_modules\\electron-rebuild\\lib\\src\\cli.js -f -w node-pty";

function toCmdUncPath(path) {
  if (path.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${path.slice("\\\\?\\UNC\\".length)}`;
  }

  if (path.startsWith("\\\\")) {
    return path;
  }

  if (/^\/[^/]+\/[^/]+/.test(path)) {
    return `\\\\${path.slice(1).replace(/\//g, "\\")}`;
  }

  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

const uncCwd = toCmdUncPath(cwd);

if (!uncCwd) {
  run("node", [
    ".\\node_modules\\electron-rebuild\\lib\\src\\cli.js",
    "-f",
    "-w",
    "node-pty",
  ]);
}

const escapedCwd = uncCwd.replace(/"/g, '""');
const command = `"pushd "${escapedCwd}" && ${rebuildCommand} & set EXIT_CODE=!ERRORLEVEL! & popd & exit /b !EXIT_CODE!"`;

run("cmd.exe", ["/v:on", "/d", "/s", "/c", command], {
  cwd: process.env.SystemRoot || "C:\\Windows",
  windowsVerbatimArguments: true,
});
