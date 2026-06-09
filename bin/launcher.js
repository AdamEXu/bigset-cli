#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_BIGSET_RELEASE_BASE =
  "https://github.com/adamexu/bigset/releases/latest/download";
const CONVEX_RELEASE_API =
  "https://api.github.com/repos/get-convex/convex-backend/releases/latest";
const NPM_REGISTRY_BASE = "https://registry.npmjs.org";
const DEFAULT_HOME = join(homedir(), ".bigset");
const USER_AGENT = "bigset-cli/0.1";
const CONVEX_INSTANCE_NAME = "bigset-local";
const KEYCHAIN_SERVICE = "ai.bigset.local-credentials";
const LOCAL_CREDENTIAL_SERVICES = new Set(["tinyfish", "openrouter"]);
const MAX_CREDENTIAL_BODY_BYTES = 64 * 1024;
const UPDATE_CHECK_TIMEOUT_MS = 2_500;
const LEGACY_NPM_PACKAGE = "@adamexu/bigset";
const CANONICAL_NPM_PACKAGE = "@tiny-fish/bigset";
const UPDATE_CHECK_PACKAGES = [CANONICAL_NPM_PACKAGE, LEGACY_NPM_PACKAGE];
const PACKAGE_JSON_PATH = fileURLToPath(new URL("../package.json", import.meta.url));

function parseArgs(argv) {
  const options = {
    bigsetUrl: process.env.BIGSET_BUILD_URL,
    convexUrl: process.env.BIGSET_CONVEX_URL,
    home: process.env.BIGSET_HOME || DEFAULT_HOME,
    force: false,
    noConvex: process.env.BIGSET_NO_CONVEX === "1",
    updateCheck:
      process.env.BIGSET_NO_UPDATE_CHECK !== "1" &&
      process.env.BIGSET_SKIP_UPDATE_CHECK !== "1",
    appPort: process.env.BIGSET_FRONTEND_PORT || "3500",
    backendPort: process.env.BIGSET_BACKEND_PORT || "3501",
    convexPort: process.env.BIGSET_CONVEX_PORT || "3210",
    convexSitePort: process.env.BIGSET_CONVEX_SITE_PORT || "3211",
    keychainPort: process.env.BIGSET_KEYCHAIN_PORT || process.env.LOCAL_KEYCHAIN_PORT || "0",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value) {
        throw new Error(`${arg} requires a value`);
      }
      return value;
    };

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--bigset-url") {
      options.bigsetUrl = next();
    } else if (arg.startsWith("--bigset-url=")) {
      options.bigsetUrl = arg.slice("--bigset-url=".length);
    } else if (arg === "--convex-url") {
      options.convexUrl = next();
    } else if (arg.startsWith("--convex-url=")) {
      options.convexUrl = arg.slice("--convex-url=".length);
    } else if (arg === "--home") {
      options.home = next();
    } else if (arg.startsWith("--home=")) {
      options.home = arg.slice("--home=".length);
    } else if (arg === "--app-port") {
      options.appPort = next();
    } else if (arg.startsWith("--app-port=")) {
      options.appPort = arg.slice("--app-port=".length);
    } else if (arg === "--backend-port") {
      options.backendPort = next();
    } else if (arg.startsWith("--backend-port=")) {
      options.backendPort = arg.slice("--backend-port=".length);
    } else if (arg === "--convex-port") {
      options.convexPort = next();
    } else if (arg.startsWith("--convex-port=")) {
      options.convexPort = arg.slice("--convex-port=".length);
    } else if (arg === "--convex-site-port") {
      options.convexSitePort = next();
    } else if (arg.startsWith("--convex-site-port=")) {
      options.convexSitePort = arg.slice("--convex-site-port=".length);
    } else if (arg === "--keychain-port") {
      options.keychainPort = next();
    } else if (arg.startsWith("--keychain-port=")) {
      options.keychainPort = arg.slice("--keychain-port=".length);
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--no-convex") {
      options.noConvex = true;
    } else if (arg === "--no-update-check") {
      options.updateCheck = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.bigsetUrl ||= defaultBigSetUrl();
  options.home = resolve(options.home);
  return options;
}

function printHelp() {
  console.log(`BigSet CLI

Usage:
  bigset [options]

Options:
  --bigset-url <url|path>    BigSet build zip. Defaults to latest platform release.
  --convex-url <url|path>    Convex backend zip. Defaults to latest GitHub release asset.
  --home <path>              Install/cache directory. Defaults to ~/.bigset.
  --app-port <port>          Frontend port. Defaults to 3500.
  --backend-port <port>      Backend port. Defaults to 3501.
  --convex-port <port>       Convex API port. Defaults to 3210.
  --convex-site-port <port>  Convex site/http-actions port. Defaults to 3211.
  --keychain-port <port>     Local credential bridge port. Defaults to any free port.
  --force                   Reinstall BigSet even if the source did not change.
  --no-convex               Skip Convex download/start.
  --no-update-check         Skip npm package update checks.
  --help                    Show this help.

Environment:
  BIGSET_BUILD_URL, BIGSET_CONVEX_URL, BIGSET_HOME, BIGSET_NO_UPDATE_CHECK
`);
}

function bigsetAssetName() {
  const arch = process.arch;
  const platform = process.platform;

  if (
    (platform === "darwin" || platform === "linux" || platform === "win32") &&
    (arch === "arm64" || arch === "x64")
  ) {
    return `bigset-build-${platform}-${arch}.zip`;
  }

  throw new Error(`No BigSet build mapping for ${platform}/${arch}`);
}

function defaultBigSetUrl() {
  return `${DEFAULT_BIGSET_RELEASE_BASE}/${bigsetAssetName()}`;
}

function displaySource(source) {
  if (isLocalSource(source)) {
    return source.startsWith("file://") ? source : pathToFileURL(resolve(source)).href;
  }
  return source;
}

function isLocalSource(source) {
  return source.startsWith("file://") || !/^https?:\/\//i.test(source);
}

function localPathFromSource(source) {
  if (source.startsWith("file://")) return fileURLToPath(source);
  return isAbsolute(source) ? source : resolve(process.cwd(), source);
}

function hashText(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function stableRemoteSource(source) {
  try {
    const url = new URL(source);
    if (url.hostname === "release-assets.githubusercontent.com") {
      url.search = "";
      url.hash = "";
      return url.href;
    }
  } catch {}
  return source;
}

async function sourceSignature(source) {
  if (isLocalSource(source)) {
    const path = localPathFromSource(source);
    const info = await stat(path);
    return {
      kind: "file",
      source: pathToFileURL(path).href,
      size: info.size,
      mtimeMs: Math.trunc(info.mtimeMs),
    };
  }

  const response = await fetch(source, {
    method: "HEAD",
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT },
  }).catch(() => null);
  if (!response?.ok) {
    return { kind: "remote", source };
  }
  return {
    kind: "remote",
    source: stableRemoteSource(response.url || source),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
    size: Number(response.headers.get("content-length") || 0) || undefined,
  };
}

function comparableSignature(signature) {
  if (signature?.kind !== "remote" || typeof signature.source !== "string") {
    return signature;
  }
  return {
    ...signature,
    source: stableRemoteSource(signature.source),
  };
}

function sameSignature(a, b) {
  return JSON.stringify(comparableSignature(a)) === JSON.stringify(comparableSignature(b));
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
}

async function readCliPackageMetadata() {
  const packageJson = await readJson(PACKAGE_JSON_PATH);
  return {
    name: typeof packageJson?.name === "string" ? packageJson.name : LEGACY_NPM_PACKAGE,
    version: typeof packageJson?.version === "string" ? packageJson.version : "0.0.0",
  };
}

function npmRegistryPackageUrl(packageName) {
  return `${NPM_REGISTRY_BASE}/${packageName.replace("/", "%2F")}`;
}

async function fetchNpmPackage(packageName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(npmRegistryPackageUrl(packageName), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/vnd.npm.install-v1+json",
      },
      signal: controller.signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status} for ${packageName}`);
    }

    const packageInfo = await response.json();
    const latest = packageInfo?.["dist-tags"]?.latest;
    if (typeof latest !== "string" || !latest) return null;
    return { name: packageName, latest };
  } finally {
    clearTimeout(timeout);
  }
}

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function comparePrereleaseIdentifier(a, b) {
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Number(a) - Number(b);
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a.localeCompare(b);
}

function comparePrerelease(a, b) {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const compared = comparePrereleaseIdentifier(a[i], b[i]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function compareSemver(a, b) {
  const parsedA = parseSemver(a);
  const parsedB = parseSemver(b);
  if (!parsedA || !parsedB) {
    return a.localeCompare(b, undefined, { numeric: true });
  }

  for (const key of ["major", "minor", "patch"]) {
    const compared = parsedA[key] - parsedB[key];
    if (compared !== 0) return compared;
  }
  return comparePrerelease(parsedA.prerelease, parsedB.prerelease);
}

function isNewerVersion(candidate, current) {
  return compareSemver(candidate, current) > 0;
}

async function resolvePackageUpdateNotice(cliPackage) {
  const entries = await Promise.all(
    UPDATE_CHECK_PACKAGES.map(async (packageName) => [
      packageName,
      await fetchNpmPackage(packageName).catch(() => null),
    ]),
  );
  const registryPackages = new Map(entries);
  const canonicalPackage = registryPackages.get(CANONICAL_NPM_PACKAGE);

  if (cliPackage.name !== CANONICAL_NPM_PACKAGE && canonicalPackage?.latest) {
    return {
      kind: "migration",
      currentPackage: cliPackage.name,
      currentVersion: cliPackage.version,
      recommendedPackage: CANONICAL_NPM_PACKAGE,
      recommendedVersion: canonicalPackage.latest,
    };
  }

  const currentPackageName = UPDATE_CHECK_PACKAGES.includes(cliPackage.name)
    ? cliPackage.name
    : LEGACY_NPM_PACKAGE;
  const currentRegistryPackage = registryPackages.get(currentPackageName);
  if (
    currentRegistryPackage?.latest &&
    isNewerVersion(currentRegistryPackage.latest, cliPackage.version)
  ) {
    return {
      kind: "update",
      currentPackage: cliPackage.name,
      currentVersion: cliPackage.version,
      recommendedPackage: currentRegistryPackage.name,
      recommendedVersion: currentRegistryPackage.latest,
    };
  }

  return null;
}

function updateCommandsForNotice(notice) {
  if (notice.kind === "migration") {
    const commands = [];
    if (notice.currentPackage) {
      commands.push(`npm uninstall -g ${notice.currentPackage}`);
    }
    commands.push(`npm install -g ${notice.recommendedPackage}`);
    return commands;
  }
  return [`npm install -g ${notice.recommendedPackage}`];
}

function printUpdateNotice(notice) {
  console.warn("");
  if (notice.kind === "migration") {
    console.warn("BigSet CLI is now published under TinyFish:");
  } else {
    console.warn("A newer BigSet CLI is available:");
  }
  console.warn(`  Installed: ${notice.currentPackage} ${notice.currentVersion}`);
  console.warn(`  Latest:    ${notice.recommendedPackage} ${notice.recommendedVersion}`);
  console.warn("");
  console.warn("Recommended update:");
  for (const command of updateCommandsForNotice(notice)) {
    console.warn(`  ${command}`);
  }
  console.warn("");
}

async function promptToLaunchOutdated(notice) {
  printUpdateNotice(notice);
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn("No interactive terminal detected; launching the installed version anyway.");
    console.warn("");
    return;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let shouldExit = false;
  try {
    const answer = await rl.question(
      `Launch ${notice.currentPackage} ${notice.currentVersion} anyway? [Y/n] `,
    );
    shouldExit = /^n(?:o)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }

  if (shouldExit) {
    console.log("Stopped before launch. Update BigSet with the command above.");
    process.exit(0);
  }
  console.log("");
}

async function maybePromptForPackageUpdate(options) {
  if (!options.updateCheck) return;
  const cliPackage = await readCliPackageMetadata();
  const notice = await resolvePackageUpdateNotice(cliPackage).catch(() => null);
  if (notice) {
    await promptToLaunchOutdated(notice);
  }
}

async function download(source, destination, label) {
  await mkdir(dirname(destination), { recursive: true });
  if (isLocalSource(source)) {
    const filePath = localPathFromSource(source);
    const total = (await stat(filePath)).size;
    await copyFileWithProgress(filePath, destination, total, label);
    return;
  }

  const response = await fetch(source, {
    redirect: "follow",
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${source}`);
  }

  const total = Number(response.headers.get("content-length") || 0);
  const file = createWriteStream(destination);
  const reader = response.body.getReader();
  let transferred = 0;
  renderProgress(label, transferred, total);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      transferred += value.byteLength;
      file.write(Buffer.from(value));
      renderProgress(label, transferred, total);
    }
  } finally {
    file.end();
  }
  await new Promise((resolveDone, rejectDone) => {
    file.on("finish", resolveDone);
    file.on("error", rejectDone);
  });
  finishProgress(label, transferred, total);
}

async function copyFileWithProgress(source, destination, total, label) {
  const input = createReadStream(source);
  const output = createWriteStream(destination);
  let transferred = 0;
  renderProgress(label, transferred, total);
  input.on("data", (chunk) => {
    transferred += chunk.length;
    renderProgress(label, transferred, total);
  });
  input.pipe(output);
  await new Promise((resolveDone, rejectDone) => {
    output.on("finish", resolveDone);
    output.on("error", rejectDone);
    input.on("error", rejectDone);
  });
  finishProgress(label, transferred, total);
}

function renderProgress(label, transferred, total) {
  if (!process.stdout.isTTY) return;
  const now = Date.now();
  const previous = progressState.get(label);
  if (previous && now - previous.updatedAt < 100 && transferred < total) return;
  progressState.set(label, { updatedAt: now });

  const width = 20;
  const ratio = total > 0 ? Math.min(transferred / total, 1) : 0;
  const done = total > 0 ? Math.round(ratio * width) : 0;
  const bar = "#".repeat(done).padEnd(width, " ");
  const suffix = total > 0
    ? `${formatBytes(transferred)} / ${formatBytes(total)}`
    : formatBytes(transferred);
  process.stdout.write(`\rProgress: [ ${bar} ] ${String(Math.round(ratio * 100)).padStart(3)}%      ${suffix}`);
}

function finishProgress(label, transferred, total) {
  if (process.stdout.isTTY) {
    renderProgress(label, transferred, total);
    progressState.delete(label);
    process.stdout.write("\n");
  } else {
    console.log(`${label}: ${formatBytes(transferred)}`);
  }
}

function formatBytes(bytes) {
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 2 : 2)} MB`;
}

function formatSignatureDetails(signature) {
  const details = [];
  if (signature?.lastModified) details.push(`modified ${signature.lastModified}`);
  if (signature?.size) details.push(formatBytes(signature.size));
  if (signature?.etag) details.push(`etag ${signature.etag}`);
  return details.length > 0 ? ` (${details.join(", ")})` : "";
}

const progressState = new Map();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    stdio: options.stdio || "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
}

function runOutput(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout.trim();
}

function powerShellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function extractZip(zipPath, destination) {
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  if (process.platform === "win32") {
    run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath ${powerShellQuote(zipPath)} -DestinationPath ${powerShellQuote(destination)} -Force`,
    ]);
    return;
  }
  run("unzip", ["-q", zipPath, "-d", destination]);
}

function bigSetCoreSource(state, options) {
  if (typeof state?.source === "string") return state.source;
  if (typeof state?.signature?.source === "string") return state.signature.source;
  return displaySource(options.bigsetUrl);
}

async function promptToUpdateBigSetCore(state, signature, options) {
  console.warn("");
  console.warn("A newer BigSet core is available:");
  console.warn(
    `  Installed: ${bigSetCoreSource(state, options)}${formatSignatureDetails(state?.signature)}`,
  );
  console.warn(
    `  Latest:    ${displaySource(options.bigsetUrl)}${formatSignatureDetails(signature)}`,
  );
  console.warn("");

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.warn("No interactive terminal detected; launching the installed BigSet core without updating.");
    console.warn("");
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question("Update BigSet core now? [Y/n] ");
    const shouldUpdate = !/^n(?:o)?$/i.test(answer.trim());
    if (!shouldUpdate) {
      console.log("Launching the installed BigSet core without updating.");
      console.log("");
    }
    return shouldUpdate;
  } finally {
    rl.close();
  }
}

async function installBigSet(options, paths) {
  const statePath = join(paths.bigsetDir, "state.json");
  const state = await readJson(statePath);
  const signature = await sourceSignature(options.bigsetUrl);
  const hasInstalledBigSet = existsSync(paths.bigsetCurrent);

  if (
    !options.force &&
    hasInstalledBigSet &&
    state?.signature &&
    sameSignature(state.signature, signature)
  ) {
    console.log(`BigSet is already installed from ${displaySource(options.bigsetUrl)}`);
    return { installed: false, updated: false };
  }

  if (
    !options.force &&
    hasInstalledBigSet &&
    state?.signature &&
    !(await promptToUpdateBigSetCore(state, signature, options))
  ) {
    return { installed: false, updated: false, skippedUpdate: true };
  }

  const downloadName = `bigset-${hashText(JSON.stringify(signature))}.zip`;
  const zipPath = join(paths.downloadsDir, downloadName);
  console.log(`Downloading BigSet from ${displaySource(options.bigsetUrl)}`);
  await download(options.bigsetUrl, zipPath, "BigSet");

  const extractDir = join(paths.bigsetDir, "extracting");
  await extractZip(zipPath, extractDir);
  const extractedRoot = join(extractDir, "bigset");
  if (!existsSync(extractedRoot)) {
    throw new Error("BigSet build zip did not contain a top-level bigset/ directory");
  }

  await rm(paths.bigsetCurrent, { recursive: true, force: true });
  await cp(extractedRoot, paths.bigsetCurrent, { recursive: true });
  await rm(extractDir, { recursive: true, force: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        source: displaySource(options.bigsetUrl),
        signature,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { installed: true, updated: hasInstalledBigSet };
}

function convexAssetName() {
  const arch = process.arch;
  const platform = process.platform;

  if (platform === "darwin" && arch === "arm64") {
    return "convex-local-backend-aarch64-apple-darwin.zip";
  }
  if (platform === "darwin" && arch === "x64") {
    return "convex-local-backend-x86_64-apple-darwin.zip";
  }
  if (platform === "linux" && arch === "arm64") {
    return "convex-local-backend-aarch64-unknown-linux-gnu.zip";
  }
  if (platform === "linux" && arch === "x64") {
    return "convex-local-backend-x86_64-unknown-linux-gnu.zip";
  }
  if (platform === "win32" && arch === "arm64") {
    console.warn(
      "No native Windows arm64 Convex backend is available; using the Windows x64 backend under emulation.",
    );
    return "convex-local-backend-x86_64-pc-windows-msvc.zip";
  }
  if (platform === "win32" && arch === "x64") {
    return "convex-local-backend-x86_64-pc-windows-msvc.zip";
  }

  throw new Error(`No Convex binary mapping for ${platform}/${arch}`);
}

async function resolveConvexDownload(options) {
  if (options.convexUrl) {
    return {
      tag: `direct-${hashText(options.convexUrl)}`,
      assetName: basename(options.convexUrl),
      url: options.convexUrl,
    };
  }

  const assetName = convexAssetName();
  const response = await fetch(CONVEX_RELEASE_API, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.github+json",
    },
  });
  if (!response.ok) {
    throw new Error(`Could not resolve latest Convex release (${response.status})`);
  }
  const release = await response.json();
  const asset = release.assets?.find((candidate) => candidate.name === assetName);
  if (!asset) {
    throw new Error(`Convex release ${release.tag_name} does not include ${assetName}`);
  }
  return {
    tag: release.tag_name,
    assetName,
    url: asset.browser_download_url,
  };
}

async function findConvexBinary(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = await findConvexBinary(path);
      if (found) return found;
    } else if (
      entry.name === "convex-local-backend" ||
      entry.name === "convex-local-backend.exe"
    ) {
      return path;
    }
  }
  return null;
}

function convexInstallDir(paths, resolved) {
  return join(paths.convexDir, resolved.tag, resolved.assetName.replace(/\.zip$/i, ""));
}

async function findInstalledConvex(paths) {
  const state = await readJson(paths.convexStatePath);
  if (typeof state?.tag === "string" && typeof state?.assetName === "string") {
    const binary = await findConvexBinary(convexInstallDir(paths, state)).catch(() => null);
    if (binary) return { ...state, binary };
  }

  const binary = await findConvexBinary(paths.convexDir).catch(() => null);
  if (!binary) return null;
  return {
    tag: "cached",
    assetName: basename(dirname(binary)),
    url: null,
    binary,
  };
}

async function writeConvexState(paths, resolved, binary) {
  await mkdir(dirname(paths.convexStatePath), { recursive: true });
  await writeFile(
    paths.convexStatePath,
    JSON.stringify(
      {
        tag: resolved.tag,
        assetName: resolved.assetName,
        url: resolved.url,
        installedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  return { ...resolved, binary };
}

async function installConvex(options, paths, bigSetInstall) {
  const currentInstall = await findInstalledConvex(paths);
  const canReuseCurrent =
    currentInstall && !options.force && !options.convexUrl && !bigSetInstall.installed;
  if (canReuseCurrent) {
    console.log(`Convex is already installed (${currentInstall.tag}, ${currentInstall.assetName})`);
    return currentInstall;
  }

  const resolved = await resolveConvexDownload(options);
  const installDir = convexInstallDir(paths, resolved);
  const binary = await findConvexBinary(installDir).catch(() => null);
  if (binary && !options.force) {
    console.log(`Convex is already installed (${resolved.tag}, ${resolved.assetName})`);
    return writeConvexState(paths, resolved, binary);
  }

  const zipPath = join(paths.downloadsDir, `${resolved.tag}-${resolved.assetName}`);
  console.log(`Downloading Convex from ${resolved.url}`);
  await download(resolved.url, zipPath, "Convex");

  await extractZip(zipPath, installDir);
  const installedBinary = await findConvexBinary(installDir);
  if (!installedBinary) {
    throw new Error(`Could not find convex-local-backend in ${resolved.assetName}`);
  }
  if (process.platform !== "win32") {
    await chmod(installedBinary, 0o755);
  }
  return writeConvexState(paths, resolved, installedBinary);
}

async function ensureConvexSecret(paths) {
  await mkdir(paths.convexDataDir, { recursive: true });
  try {
    const existing = (await readFile(paths.convexSecretPath, "utf8")).trim();
    if (/^[a-f0-9]{64}$/i.test(existing)) return existing;
  } catch {}

  const secret = randomBytes(32).toString("hex");
  await writeFile(paths.convexSecretPath, `${secret}\n`, { mode: 0o600 });
  await chmod(paths.convexSecretPath, 0o600).catch(() => {});
  return secret;
}

function convexAdminKey(convexInstall, instanceSecret) {
  return runOutput(convexInstall.binary, [
    "keygen",
    "admin-key",
    "--instance-name",
    CONVEX_INSTANCE_NAME,
    "--instance-secret",
    instanceSecret,
  ]);
}

function isLocalCredentialService(value) {
  return typeof value === "string" && LOCAL_CREDENTIAL_SERVICES.has(value);
}

function localCredentialAccount(workspaceId, service) {
  return `${workspaceId}:${service}`;
}

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

async function readCredentialBody(req) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_CREDENTIAL_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed;
}

async function readCredentialFile(paths) {
  try {
    const parsed = JSON.parse(await readFile(paths.credentialsPath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.credentials) {
      return parsed.credentials;
    }
  } catch {}
  return {};
}

async function writeCredentialFile(paths, credentials) {
  await mkdir(dirname(paths.credentialsPath), { recursive: true });
  const tempPath = `${paths.credentialsPath}.${process.pid}.tmp`;
  await writeFile(
    tempPath,
    JSON.stringify({ version: 1, credentials }, null, 2),
    { mode: 0o600 },
  );
  await rename(tempPath, paths.credentialsPath);
  await chmod(paths.credentialsPath, 0o600).catch(() => {});
}

async function createCredentialStore(paths) {
  try {
    const keyring = await import("@napi-rs/keyring");
    const Entry = keyring.Entry;
    if (typeof Entry === "function") {
      return {
        label: "OS keychain",
        get(account) {
          return new Entry(KEYCHAIN_SERVICE, account).getPassword();
        },
        set(account, apiKey) {
          new Entry(KEYCHAIN_SERVICE, account).setPassword(apiKey);
        },
        delete(account) {
          return new Entry(KEYCHAIN_SERVICE, account).deletePassword();
        },
      };
    }
  } catch {}

  return {
    label: "local 0600 file",
    async get(account) {
      const credentials = await readCredentialFile(paths);
      return credentials[account] ?? null;
    },
    async set(account, apiKey) {
      const credentials = await readCredentialFile(paths);
      credentials[account] = apiKey;
      await writeCredentialFile(paths, credentials);
    },
    async delete(account) {
      const credentials = await readCredentialFile(paths);
      const existed = Object.hasOwn(credentials, account);
      delete credentials[account];
      await writeCredentialFile(paths, credentials);
      return existed;
    },
  };
}

async function startCredentialBridge(options, paths) {
  const store = await createCredentialStore(paths);
  const token = randomBytes(32).toString("hex");
  const workspaceId =
    process.env.BIGSET_LOCAL_WORKSPACE_ID || `bigset-${hashText(options.home)}`;
  const bindHost = "127.0.0.1";

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url || "/", `http://${bindHost}`);

      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { status: "ok", workspaceId });
        return;
      }

      if (req.headers.authorization !== `Bearer ${token}`) {
        writeJson(res, 401, { error: "Unauthorized" });
        return;
      }

      if (req.method !== "POST") {
        writeJson(res, 405, { error: "Method not allowed" });
        return;
      }

      try {
        const body = await readCredentialBody(req);
        if (!isLocalCredentialService(body.service)) {
          throw new Error("Unsupported credential service.");
        }

        const account = localCredentialAccount(workspaceId, body.service);
        if (url.pathname === "/credentials/get") {
          writeJson(res, 200, {
            apiKey: await store.get(account),
            keychainAccount: account,
          });
          return;
        }

        if (url.pathname === "/credentials/set") {
          if (typeof body.apiKey !== "string" || !body.apiKey.trim()) {
            writeJson(res, 400, { error: "API key is required." });
            return;
          }
          await store.set(account, body.apiKey);
          writeJson(res, 200, { keychainAccount: account });
          return;
        }

        if (url.pathname === "/credentials/delete") {
          writeJson(res, 200, { deleted: await store.delete(account) });
          return;
        }

        writeJson(res, 404, { error: "Not found" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Credential bridge failed.";
        writeJson(res, 400, { error: message });
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "Credential bridge failed.";
      writeJson(res, 500, { error: message });
    });
  });

  const requestedPort = Number(options.keychainPort);
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(Number.isInteger(requestedPort) ? requestedPort : 0, bindHost, () => {
      server.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start local credential bridge.");
  }

  return {
    server,
    storageLabel: store.label,
    token,
    workspaceId,
    url: `http://${bindHost}:${address.port}`,
  };
}

function deployConvexApp(paths, convexUrl, convexAdminKeyValue) {
  const convexCli = join(
    paths.bigsetCurrent,
    "frontend",
    "node_modules",
    "convex",
    "bin",
    "main.js",
  );
  const convexSourceDir = join(paths.bigsetCurrent, "frontend", "convex");
  if (!existsSync(convexCli) || !existsSync(convexSourceDir)) {
    throw new Error(
      "BigSet build does not include Convex deployment files. Rebuild the release artifact.",
    );
  }

  console.log("Deploying BigSet Convex functions...");
  const convexDeployEnv = {
    CONVEX_SELF_HOSTED_URL: convexUrl,
    CONVEX_SELF_HOSTED_ADMIN_KEY: convexAdminKeyValue,
  };
  const convexFrontendDir = join(paths.bigsetCurrent, "frontend");
  const setConvexEnv = (name, value) => {
    run(process.execPath, [
      convexCli,
      "env",
      "set",
      name,
      value,
      "--url",
      convexUrl,
      "--admin-key",
      convexAdminKeyValue,
    ], {
      cwd: convexFrontendDir,
      env: convexDeployEnv,
    });
  };

  setConvexEnv("BIGSET_LOCAL_MODE", "1");
  setConvexEnv("CLERK_JWT_ISSUER_DOMAIN", "https://bigset-local.invalid");

  run(process.execPath, [
    convexCli,
    "deploy",
    "--url",
    convexUrl,
    "--admin-key",
    convexAdminKeyValue,
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
  ], {
    cwd: convexFrontendDir,
    env: convexDeployEnv,
  });
}

function prefixedPipe(child, name) {
  child.stdout?.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr?.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await new Promise((resolveDone) => setTimeout(resolveDone, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function runBigSet(options, paths, convexInstall) {
  const appUrl = `http://127.0.0.1:${options.appPort}`;
  const backendUrl = `http://127.0.0.1:${options.backendPort}`;
  const convexUrl = `http://127.0.0.1:${options.convexPort}`;
  const convexSiteUrl = `http://127.0.0.1:${options.convexSitePort}`;
  const children = [];
  const servers = [];
  let shuttingDown = false;

  function cleanup() {
    for (const child of children) {
      if (!child.killed) child.kill("SIGTERM");
    }
    for (const server of servers) {
      server.close();
    }
  }

  function shutdown(code = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    cleanup();
    setTimeout(() => process.exit(code), 400).unref();
  }

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));

  try {
    const credentialBridge = await startCredentialBridge(options, paths);
    servers.push(credentialBridge.server);
    console.log(`Local credential bridge: ${credentialBridge.url} (${credentialBridge.storageLabel})`);

    let convexAdminKeyValue = "";
    if (convexInstall) {
      await mkdir(paths.convexDataDir, { recursive: true });
      const convexSecret = await ensureConvexSecret(paths);
      convexAdminKeyValue = convexAdminKey(convexInstall, convexSecret);
      const convex = spawn(convexInstall.binary, [
        "--interface",
        "127.0.0.1",
        "--port",
        options.convexPort,
        "--site-proxy-port",
        options.convexSitePort,
        "--convex-origin",
        convexUrl,
        "--convex-site",
        convexSiteUrl,
        "--instance-name",
        CONVEX_INSTANCE_NAME,
        "--instance-secret",
        convexSecret,
        "--local-storage",
        join(paths.convexDataDir, "storage"),
        "--disable-beacon",
        join(paths.convexDataDir, "convex.sqlite3"),
      ], {
        cwd: paths.convexDataDir,
        env: {
          ...process.env,
          DISABLE_BEACON: "true",
          DISABLE_METRICS_ENDPOINT: "true",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      children.push(convex);
      prefixedPipe(convex, "convex");
      convex.once("exit", (code, signal) => {
        if (!shuttingDown) {
          console.error(`Convex exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`);
          shutdown(code ?? 1);
        }
      });
      await waitForHttp(`${convexUrl}/version`, 30_000);
      deployConvexApp(paths, convexUrl, convexAdminKeyValue);
    }

    const startScript = join(paths.bigsetCurrent, "start.mjs");
    if (!existsSync(startScript)) {
      throw new Error(`BigSet start script not found at ${startScript}`);
    }

    const bigset = spawn(process.execPath, [startScript], {
      cwd: paths.bigsetCurrent,
      env: {
        ...process.env,
        BIGSET_FRONTEND_PORT: options.appPort,
        BIGSET_BACKEND_PORT: options.backendPort,
        NEXT_PUBLIC_BACKEND_URL: backendUrl,
        CONVEX_URL: convexUrl,
        NEXT_PUBLIC_CONVEX_URL: convexUrl,
        CONVEX_SELF_HOSTED_ADMIN_KEY: convexAdminKeyValue,
        LOCAL_KEYCHAIN_URL: credentialBridge.url,
        LOCAL_KEYCHAIN_TOKEN: credentialBridge.token,
        LOCAL_KEYCHAIN_TIMEOUT_MS: process.env.LOCAL_KEYCHAIN_TIMEOUT_MS || "5000",
        BIGSET_LOCAL_WORKSPACE_ID: credentialBridge.workspaceId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(bigset);
    prefixedPipe(bigset, "bigset");
    bigset.once("exit", (code, signal) => {
      if (!shuttingDown) {
        console.error(`BigSet exited${signal ? ` with signal ${signal}` : ` with code ${code}`}`);
        shutdown(code ?? 1);
      }
    });

    await waitForHttp(`${backendUrl}/health`, 30_000);
    await waitForHttp(appUrl, 30_000);

    console.log("");
    console.log("BigSet is running:");
    console.log(`  App:     ${appUrl}`);
    console.log(`  Backend: ${backendUrl}`);
    if (convexInstall) console.log(`  Convex:  ${convexUrl}`);
    console.log("");
    console.log("Press Ctrl+C to stop.");
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const paths = {
    home: options.home,
    downloadsDir: join(options.home, "downloads"),
    bigsetDir: join(options.home, "bigset"),
    bigsetCurrent: join(options.home, "bigset", "current"),
    convexDir: join(options.home, "convex"),
    convexStatePath: join(options.home, "convex", "state.json"),
    convexDataDir: join(options.home, "data", "convex"),
    convexSecretPath: join(options.home, "data", "convex", "instance-secret"),
    credentialsPath: join(options.home, "data", "credentials.json"),
  };

  await maybePromptForPackageUpdate(options);
  await mkdir(paths.home, { recursive: true });
  console.log("Setting up BigSet...");
  console.log(`Node version: ${process.version}`);
  console.log(`Install dir:   ${paths.home}`);
  console.log("");

  const bigSetInstall = await installBigSet(options, paths);
  const convexInstall = options.noConvex ? null : await installConvex(options, paths, bigSetInstall);
  await runBigSet(options, paths, convexInstall);
}

main().catch((error) => {
  console.error("");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
