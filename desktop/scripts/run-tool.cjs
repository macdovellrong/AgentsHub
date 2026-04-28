const { spawnSync } = require("node:child_process");

const cwd = process.cwd();
const toolArgs = process.argv.slice(2);

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

function quoteCmdArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (/[\r\n]/.test(value)) {
    throw new Error("Command arguments cannot contain newlines");
  }

  return value
    .split("%")
    .map((segment) => `"${segment.replace(/"/g, '""')}"`)
    .join("^%");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    ...options,
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

if (toolArgs.length === 0) {
  console.error("Usage: node ./scripts/run-tool.cjs <tool> [...args]");
  process.exit(1);
}

const uncCwd = toCmdUncPath(cwd);

if (!uncCwd) {
  run(process.execPath, toolArgs);
}

const commandBody = [
  "pushd",
  quoteCmdArg(uncCwd),
  "&&",
  quoteCmdArg(process.execPath),
  ...toolArgs.map(quoteCmdArg),
].join(" ");

run("cmd.exe", ["/d", "/s", "/c", `"${commandBody}"`], {
  cwd: process.env.SystemRoot || "C:\\Windows",
  windowsVerbatimArguments: true,
});
