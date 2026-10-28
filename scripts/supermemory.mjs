#!/usr/bin/env node
// Manual memory helper for this OpenCode config repo.
//
// Uses the Supermemory v5 HTTP API directly. This repo intentionally has no
// package.json (it is gitignored), so there is no local package project to
// install the `supermemory` SDK into. Every call is namespace-scoped in the
// URL and reads the key from SUPERMEMORY_API_KEY, the global config file, or
// the plugin credentials file (first match wins).
//
// Namespaces are resolved per project; see scripts/lib/namespaces.mjs for the
// precedence chain and the allowedUserNs guardrail. Print the effective values
// with `config`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_USER_NS,
  defaultGlobalConfigPath,
  isValidNamespace,
  resolveApiKey,
  resolveNamespaces,
} from "./lib/namespaces.mjs";

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), ".."));
const API_BASE = (process.env.SUPERMEMORY_API_BASE ?? "https://api.supermemory.ai").replace(/\/+$/, "");
const KEY_INFO = resolveApiKey();
const KEY = KEY_INFO.value;

const USAGE = `Usage: node scripts/supermemory.mjs <command> [args]

Commands:
  profile                    Always-on profile for the user namespace
  recall <query>             Search memories in the user namespace
  remember <text>            Save a durable decision to the user namespace
  index                      Re-ingest this repo's README + git log into the project namespace
  docs <query>               Search chunks in the project namespace
  status <id>                Document pipeline status in the user namespace
  config                     Show the resolved namespaces and where they came from

Options:
  --limit <n>                Max results (default 5)
  --threshold <0-1>          Similarity cutoff (recall 0.5, docs 0.3)
  --id <id>                  Stable document id for remember
  --user-ns <ns>             Override the user namespace for this call
  --project-ns <ns>          Override the project namespace for this call
  --json                     Machine-readable output (config)

Namespace resolution (highest precedence first):
  --user-ns / --project-ns, then SUPERMEMORY_USER_NS / SUPERMEMORY_PROJECT_NS,
  then <repo>/.opencode/memory.local.jsonc, then <repo>/.opencode/memory.jsonc,
  then ${defaultGlobalConfigPath()}, then defaults (${DEFAULT_USER_NS} / project_<repo>).
  A user namespace from a project file must equal the global default or appear
  in namespaces.allowedUserNs (global config) or SUPERMEMORY_ALLOWED_USER_NS.

Environment:
  SUPERMEMORY_API_KEY        API key (else global config or plugin credentials)
  SUPERMEMORY_API_BASE       Optional, defaults to https://api.supermemory.ai
  SUPERMEMORY_USER_NS        Optional user namespace override
  SUPERMEMORY_PROJECT_NS     Optional project namespace override
  SUPERMEMORY_ALLOWED_USER_NS  Optional comma-separated allowlist
  SUPERMEMORY_CONFIG_DIR     Optional, defaults to ~/.config/opencode`;

const [command, ...rest] = process.argv.slice(2);
const { flags, query } = parseArgs(rest);
const resolved = resolveNamespaces({
  flags: { userNs: flags["user-ns"], projectNs: flags["project-ns"] },
  warn: (message) => console.error(`supermemory: ${message}`),
});
const USER_NS = resolved.user.value;
const PROJECT_NS = resolved.project.value;

function fail(message) {
  console.error(`supermemory: ${message}`);
  process.exit(1);
}

function assertNamespace(namespace) {
  if (!isValidNamespace(namespace)) {
    fail(`invalid namespace "${namespace}" (allowed: letters, digits, "_", ":", "-", max 100 chars)`);
  }
}

function assertConfigRepo(commandName) {
  if (resolve(resolved.projectRoot) !== ROOT) {
    fail(
      `${commandName} only indexes this config repo (${ROOT}); ` +
        `run it from there. Nothing indexes ${resolved.projectRoot} yet.`,
    );
  }
}

async function call(namespace, action, body, method = "POST") {
  assertNamespace(namespace);
  if (!KEY) {
    fail(
      "no API key (checked SUPERMEMORY_API_KEY, " +
        `${defaultGlobalConfigPath()}, and ~/.supermemory-opencode/credentials.json)`,
    );
  }

  const headers = { Authorization: `Bearer ${KEY}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${API_BASE}/ns/${encodeURIComponent(namespace)}/${action}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    fail(`request to ${API_BASE} failed: ${error.message}`);
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const detail =
      data && typeof data === "object"
        ? data.error ?? data.details ?? JSON.stringify(data)
        : String(data ?? res.statusText);
    fail(`${res.status} ${res.statusText}: ${detail}`);
  }

  return data;
}

function parseArgs(argv) {
  const flags = {};
  const words = [];
  const valueFlags = ["limit", "threshold", "id", "user-ns", "project-ns"];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = arg.match(/^--(limit|threshold|id|user-ns|project-ns)=(.*)$/);
    if (match) {
      flags[match[1]] = match[2];
    } else if (valueFlags.includes(arg.slice(2)) && arg.startsWith("--")) {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i += 1;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg.startsWith("--")) {
      fail(`unknown option ${arg}`);
    } else {
      words.push(arg);
    }
  }
  return { flags, query: words.join(" ").trim() };
}

function integerFlag(value, fallback, min, max) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    fail(`expected an integer between ${min} and ${max}, got "${value}"`);
  }
  return parsed;
}

function numberFlag(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    fail(`expected a number between 0 and 1, got "${value}"`);
  }
  return parsed;
}

function oneLine(text, width = 600) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
}

function printResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    console.log("(no results)");
    return;
  }
  for (const result of results) {
    const score = typeof result.similarity === "number" ? result.similarity.toFixed(3) : "?";
    const text = result.memory ?? result.chunk ?? result.content ?? JSON.stringify(result);
    console.log(`- [${score}] ${oneLine(text)}`);
  }
}

function config() {
  if (flags.json) {
    console.log(JSON.stringify({ ...resolved, apiKeySource: KEY_INFO.source }, null, 2));
    return;
  }
  const rows = [
    ["user", resolved.user.value, resolved.user.source],
    ["project", resolved.project.value, resolved.project.source],
  ];
  console.log(`# Namespaces — ${resolved.projectRoot}`);
  const width = Math.max(...rows.map(([label]) => label.length));
  const valueWidth = Math.max(...rows.map(([, value]) => value.length));
  for (const [label, value, source] of rows) {
    console.log(`${label.padEnd(width)}  ${value.padEnd(valueWidth)}  ${source}`);
  }
  console.log(`allowed user namespaces: ${resolved.allowedUserNs.join(", ") || "(none beyond the default)"}`);
  if (resolved.paths.projectLocal) console.log(`local override: ${resolved.paths.projectLocal}`);
  if (resolved.user.source.startsWith("project")) {
    console.log(`note: user namespace comes from ${resolved.user.source}; it is allowlisted, not the default`);
  }
}

async function profile() {
  const data = await call(USER_NS, "profile", {});
  const { static: stable = [], dynamic = [] } = data?.profile ?? {};
  console.log(`# Profile — ${USER_NS}`);
  if (stable.length === 0 && dynamic.length === 0) {
    console.log("(empty; save a decision with `remember` first)");
    return;
  }
  console.log("\n## Static");
  for (const item of stable) console.log(`- ${oneLine(item.memory)}`);
  console.log("\n## Dynamic");
  for (const item of dynamic) console.log(`- ${oneLine(item.memory)}`);
}

async function recall(flags, query) {
  if (!query) fail("recall needs a query");
  const data = await call(USER_NS, "search", {
    query,
    searchMode: "memories",
    limit: integerFlag(flags.limit, 5, 1, 100),
    threshold: numberFlag(flags.threshold, 0.5),
  });
  console.log(`# Memories — ${USER_NS}`);
  printResults(data?.results);
}

async function remember(flags, text) {
  if (!text) fail("remember needs text");
  const body = {
    content: text,
    taskType: "memory",
    // Instant extraction costs one extra operation per document, but a saved
    // decision is recallable as soon as processing finishes. Dynamic mode can
    // take minutes to form memories, which defeats "recall before answering".
    dreaming: "instant",
    metadata: {
      source: "opencode",
      kind: "decision",
      recorded: new Date().toISOString().slice(0, 10),
      project: resolved.projectRoot,
    },
  };
  if (flags.id) body.id = flags.id;

  const data = await call(USER_NS, "document", body);
  console.log(`queued ${data?.id ?? "(no id)"} in ${USER_NS} (status: ${data?.status ?? "unknown"})`);
  console.log("Instant processing bills one extra operation; poll with `status <id>` before relying on recall.");
}

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
}

async function index() {
  assertConfigRepo("index");
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  const log = git(["log", "--pretty=format:- %h %ad %s", "--date=short", "-n", "100"]);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  let remote = "";
  try {
    remote = git(["config", "--get", "remote.origin.url"]);
  } catch {
    remote = "(no origin remote)";
  }

  const documents = [
    {
      id: "readme-md",
      content: `# README.md — opencode-conf\n\n${readme}`,
      metadata: { source: "README.md", kind: "docs", path: "README.md" },
    },
    {
      id: "git-log",
      content: `# Commit history — opencode-conf\n\nbranch: ${branch}\nremote: ${remote}\n\n${log}\n`,
      metadata: { source: "git log", kind: "history" },
    },
  ];

  const data = await call(PROJECT_NS, "document/batch", {
    documents,
    taskType: "superrag",
  });

  console.log(`# Indexed into ${PROJECT_NS}`);
  console.log(`accepted: ${data?.count ?? "?"}, failed: ${data?.failed ?? "?"}`);
  for (const result of data?.results ?? []) {
    const suffix = result.error ? ` — ${result.error}` : "";
    console.log(`- ${result.id}: ${result.status}${suffix}`);
  }
  console.log("superrag processes asynchronously; `docs` may be empty for a short while.");
}

async function docs(flags, query) {
  if (!query) fail("docs needs a query");
  const data = await call(PROJECT_NS, "search", {
    query,
    searchMode: "chunks",
    limit: integerFlag(flags.limit, 5, 1, 100),
    threshold: numberFlag(flags.threshold, 0.3),
  });
  console.log(`# Chunks — ${PROJECT_NS}`);
  printResults(data?.results);
}

async function status(flags, id) {
  if (!id) fail("status needs a document id");
  const data = await call(USER_NS, `document/${encodeURIComponent(id)}`, undefined, "GET");
  const state = data?.system?.status ?? data?.status ?? "unknown";
  const dreaming = data?.system?.dreamingStatus ?? data?.dreamingStatus;
  const progress = data?.progress ?? data?.system?.progress;
  const parts = [`${data?.id ?? id}: ${state}`];
  if (typeof progress === "number") parts.push(`${progress}%`);
  if (dreaming) parts.push(`dreaming: ${dreaming}`);
  console.log(parts.join(" — "));
}

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

try {
  switch (command) {
    case "profile":
      await profile();
      break;
    case "recall":
      await recall(flags, query);
      break;
    case "remember":
      await remember(flags, query);
      break;
    case "index":
      await index();
      break;
    case "docs":
      await docs(flags, query);
      break;
    case "status":
      await status(flags, query);
      break;
    case "config":
      config();
      break;
    default:
      fail(`unknown command "${command}"\n\n${USAGE}`);
  }
} catch (error) {
  fail(error.message);
}
