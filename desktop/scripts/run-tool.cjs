const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const pathModule = require("node:path");

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

function normalizeUncPath(value) {
  return value.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function findMappedDrivePath(uncPath) {
  const normalizedUnc = normalizeUncPath(uncPath);
  let bestMatch = null;

  for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const driveRoot = `${letter}:\\`;
    let mappedRoot;
    try {
      mappedRoot = fs.realpathSync.native(driveRoot);
    } catch {
      continue;
    }

    if (!mappedRoot.startsWith("\\\\")) {
      continue;
    }

    const normalizedMappedRoot = normalizeUncPath(mappedRoot);
    const isMatch =
      normalizedUnc === normalizedMappedRoot ||
      normalizedUnc.startsWith(`${normalizedMappedRoot}\\`);

    if (!isMatch) {
      continue;
    }

    if (!bestMatch || normalizedMappedRoot.length > bestMatch.normalizedMappedRoot.length) {
      bestMatch = { driveRoot, mappedRoot, normalizedMappedRoot };
    }
  }

  if (!bestMatch) {
    return null;
  }

  const tail = uncPath.slice(bestMatch.mappedRoot.length).replace(/^\\+/, "");
  return tail ? pathModule.join(bestMatch.driveRoot, tail) : bestMatch.driveRoot;
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

const mappedCwd = findMappedDrivePath(uncCwd);

if (mappedCwd) {
  run(process.execPath, toolArgs, {
    cwd: mappedCwd,
    env: {
      ...process.env,
      INIT_CWD: mappedCwd,
      PWD: mappedCwd,
    },
  });
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
