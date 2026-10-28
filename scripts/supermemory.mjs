#!/usr/bin/env node
// Manual memory helper for this OpenCode config repo.
//
// Uses the Supermemory v5 HTTP API directly. This repo intentionally has no
// package.json (it is gitignored), so there is no local package project to
// install the `supermemory` SDK into. Every call is namespace-scoped in the
// URL and reads the key from SUPERMEMORY_API_KEY.
//
// Namespaces:
//   opencode:ashley      durable operator preferences/decisions (taskType memory)
//   project_opencode_conf  README + commit history for this repo (taskType superrag)

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API_BASE = (process.env.SUPERMEMORY_API_BASE ?? "https://api.supermemory.ai").replace(/\/+$/, "");
const USER_NS = process.env.SUPERMEMORY_USER_NS ?? "opencode:ashley";
const PROJECT_NS = process.env.SUPERMEMORY_PROJECT_NS ?? "project_opencode_conf";
const NS_PATTERN = /^[a-zA-Z0-9_:-]{1,100}$/;
const KEY = process.env.SUPERMEMORY_API_KEY;

const USAGE = `Usage: node scripts/supermemory.mjs <command> [args]

Commands:
  profile                    Always-on profile for ${USER_NS}
  recall <query>             Search memories in ${USER_NS}
  remember <text>            Save a durable decision to ${USER_NS}
  index                      Re-ingest README + git log into ${PROJECT_NS}
  docs <query>               Search chunks in ${PROJECT_NS}
  status <id>                Document pipeline status in ${USER_NS}

Options:
  --limit <n>                Max results (default 5)
  --threshold <0-1>          Similarity cutoff (recall 0.5, docs 0.3)
  --id <id>                  Stable document id for remember

Environment:
  SUPERMEMORY_API_KEY        Required
  SUPERMEMORY_API_BASE       Optional, defaults to https://api.supermemory.ai
  SUPERMEMORY_USER_NS        Optional, defaults to ${USER_NS}
  SUPERMEMORY_PROJECT_NS     Optional, defaults to ${PROJECT_NS}`;

function fail(message) {
  console.error(`supermemory: ${message}`);
  process.exit(1);
}

function assertNamespace(namespace) {
  if (!NS_PATTERN.test(namespace)) {
    fail(`invalid namespace "${namespace}" (allowed: letters, digits, "_", ":", "-", max 100 chars)`);
  }
}

async function call(namespace, action, body, method = "POST") {
  assertNamespace(namespace);
  if (!KEY) {
    fail("SUPERMEMORY_API_KEY is not set (environment or ~/.config/opencode/supermemory.jsonc)");
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
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const match = arg.match(/^--(limit|threshold|id)=(.*)$/);
    if (match) {
      flags[match[1]] = match[2];
    } else if (arg === "--limit" || arg === "--threshold" || arg === "--id") {
      const value = argv[i + 1];
      if (value === undefined) fail(`${arg} needs a value`);
      flags[arg.slice(2)] = value;
      i += 1;
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
    },
  };
  if (flags.id) body.id = flags.id;

  const data = await call(USER_NS, "document", body);
  console.log(`queued ${data?.id ?? "(no id)"} (status: ${data?.status ?? "unknown"})`);
  console.log("Instant processing bills one extra operation; poll with `status <id>` before relying on recall.");
}

function git(args) {
  return execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
}

async function index() {
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

const [command, ...rest] = process.argv.slice(2);

if (!command || command === "help" || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

const { flags, query } = parseArgs(rest);

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
    default:
      fail(`unknown command "${command}"\n\n${USAGE}`);
  }
} catch (error) {
  fail(error.message);
}
