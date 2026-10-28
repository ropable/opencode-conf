// Unit tests for namespace resolution. Dependency-free: node --test.
//
//   node --test scripts/namespaces.test.mjs

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  DEFAULT_USER_NS,
  defaultProjectNamespace,
  findProjectRoot,
  resolveApiKey,
  resolveNamespaces,
  slug,
  stripJsonc,
} from "./lib/namespaces.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "supermemory.mjs");

function makeTree() {
  return mkdtempSync(join(tmpdir(), "supermemory-ns-"));
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
}

function repo({ global, project, local } = {}) {
  const dir = makeTree();
  mkdirSync(join(dir, ".git"), { recursive: true });
  const globalPath = join(dir, "supermemory.jsonc");
  if (global) write(globalPath, global);
  if (project) write(join(dir, ".opencode/memory.jsonc"), project);
  if (local) write(join(dir, ".opencode/memory.local.jsonc"), local);
  return { dir, globalPath };
}

test("falls back to built-in defaults without any config", () => {
  const dir = makeTree();
  mkdirSync(join(dir, ".git"));
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: join(dir, "absent.jsonc") });

  assert.equal(res.user.value, DEFAULT_USER_NS);
  assert.equal(res.user.source, "default");
  assert.equal(res.project.value, defaultProjectNamespace(dir));
  assert.equal(res.project.value, `project_${slug(basename(dir))}`);
  assert.equal(res.project.source, "default");
  assert.deepEqual(res.warnings, []);
});

test("global config supplies both namespaces", () => {
  const { dir, globalPath } = repo({ global: { namespaces: { user: "opencode:global", project: "project_global" } } });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.user.value, "opencode:global");
  assert.equal(res.project.value, "project_global");
  assert.match(res.user.source, /^global:/);
});

test("committed project file beats the global config", () => {
  const { dir, globalPath } = repo({
    global: { namespaces: { user: "opencode:global", project: "project_global" } },
    project: { namespaces: { project: "project_repo" } },
  });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.project.value, "project_repo");
  assert.match(res.project.source, /^project:.*\.opencode\/memory\.jsonc$/);
  assert.equal(res.user.value, "opencode:global");
});

test("local project file merges over the committed one field by field", () => {
  const { dir, globalPath } = repo({
    project: { namespaces: { project: "project_repo", user: DEFAULT_USER_NS } },
    local: { namespaces: { user: "opencode:ashley:work" } },
  });
  const res = resolveNamespaces({
    cwd: dir,
    env: { SUPERMEMORY_ALLOWED_USER_NS: "opencode:ashley:work" },
    globalConfigPath: globalPath,
  });

  assert.equal(res.user.value, "opencode:ashley:work");
  assert.equal(res.project.value, "project_repo");
  assert.match(res.user.source, /^project-local:/);
});

test("environment overrides project files, flags override environment", () => {
  const { dir, globalPath } = repo({ project: { namespaces: { project: "project_repo" } } });

  const envRes = resolveNamespaces({
    cwd: dir,
    env: { SUPERMEMORY_USER_NS: "opencode:from-env", SUPERMEMORY_PROJECT_NS: "project_from_env" },
    globalConfigPath: globalPath,
  });
  assert.equal(envRes.user.value, "opencode:from-env");
  assert.equal(envRes.user.source, "env");
  assert.equal(envRes.project.value, "project_from_env");

  const flagRes = resolveNamespaces({
    cwd: dir,
    env: { SUPERMEMORY_USER_NS: "opencode:from-env", SUPERMEMORY_PROJECT_NS: "project_from_env" },
    flags: { userNs: "opencode:from-flag", projectNs: "project_from_flag" },
    globalConfigPath: globalPath,
  });
  assert.equal(flagRes.user.value, "opencode:from-flag");
  assert.equal(flagRes.user.source, "flag");
  assert.equal(flagRes.project.value, "project_from_flag");
});

test("nested directories resolve the repository root", () => {
  const { dir, globalPath } = repo({ project: { namespaces: { project: "project_repo" } } });
  const nested = join(dir, "src", "deep", "dir");
  mkdirSync(nested, { recursive: true });

  assert.equal(findProjectRoot(nested), dir);
  const res = resolveNamespaces({ cwd: nested, env: {}, globalConfigPath: globalPath });
  assert.equal(res.projectRoot, dir);
  assert.equal(res.project.value, "project_repo");
});

test("invalid JSON in a project file warns and falls back", () => {
  const { dir, globalPath } = repo({ global: { namespaces: { project: "project_global" } }, project: "{ nope" });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.project.value, "project_global");
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /project config .*memory\.jsonc/);
});

test("a namespace that fails the pattern warns and is skipped", () => {
  const { dir, globalPath } = repo({
    global: { namespaces: { project: "project_global" } },
    project: { namespaces: { project: "has spaces" } },
  });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.project.value, "project_global");
  assert.match(res.warnings[0], /invalid/);
});

test("guardrail: project files cannot point the user namespace at arbitrary values", () => {
  const { dir, globalPath } = repo({
    global: { namespaces: { user: DEFAULT_USER_NS } },
    project: { namespaces: { user: "opencode:someone-else" } },
  });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.user.value, DEFAULT_USER_NS);
  assert.match(res.user.source, /^global:/);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /not in allowedUserNs/);
});

test("guardrail: allowlisted user namespaces from project files are accepted", () => {
  const { dir, globalPath } = repo({
    global: { namespaces: { user: DEFAULT_USER_NS, allowedUserNs: [DEFAULT_USER_NS, "opencode:ashley:work"] } },
    project: { namespaces: { user: "opencode:ashley:work" } },
  });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.user.value, "opencode:ashley:work");
  assert.match(res.user.source, /^project:/);
  assert.deepEqual(res.warnings, []);
});

test("guardrail: project namespaces are not restricted", () => {
  const { dir, globalPath } = repo({ project: { namespaces: { project: "project_anything" } } });
  const res = resolveNamespaces({ cwd: dir, env: {}, globalConfigPath: globalPath });

  assert.equal(res.project.value, "project_anything");
  assert.deepEqual(res.warnings, []);
});

test("stripJsonc preserves string contents and drops comments and trailing commas", () => {
  const source = `{
    // line comment with } and ]
    "url": "https://example.test/a//b",
    "quoted": "keep /* this */ intact",
    /* block
       comment */
    "list": [1, 2, 3,],
  }`;
  const parsed = JSON.parse(stripJsonc(source));

  assert.equal(parsed.url, "https://example.test/a//b");
  assert.equal(parsed.quoted, "keep /* this */ intact");
  assert.deepEqual(parsed.list, [1, 2, 3]);
});

test("resolveApiKey prefers the environment, then the global config, then credentials", () => {
  const { dir, globalPath } = repo({ global: { apiKey: "sm_from_file" } });

  assert.equal(resolveApiKey({ env: { SUPERMEMORY_API_KEY: "sm_from_env" }, globalConfigPath: globalPath }).value, "sm_from_env");
  assert.equal(
    resolveApiKey({ env: {}, globalConfigPath: globalPath, credentialsPath: join(dir, "absent.json") }).value,
    "sm_from_file",
  );
  assert.equal(
    resolveApiKey({ env: {}, globalConfigPath: join(dir, "absent.jsonc"), credentialsPath: join(dir, "absent.json") })
      .value,
    null,
  );
});

test("config command reports the effective namespaces as JSON", () => {
  const dir = makeTree();
  mkdirSync(join(dir, ".git"), { recursive: true });
  write(join(dir, ".opencode/memory.jsonc"), { namespaces: { project: "project_cli" } });
  const configDir = makeTree();
  write(join(configDir, "supermemory.jsonc"), { namespaces: { user: DEFAULT_USER_NS } });

  const output = execFileSync(process.execPath, [SCRIPT, "config", "--json"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, SUPERMEMORY_CONFIG_DIR: configDir, SUPERMEMORY_API_KEY: "", SUPERMEMORY_USER_NS: "" },
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.project.value, "project_cli");
  assert.equal(parsed.user.value, DEFAULT_USER_NS);
  assert.equal(parsed.projectRoot, dir);
});
