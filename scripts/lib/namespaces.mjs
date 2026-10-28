// Namespace and credential resolution for the manual Supermemory helper.
//
// One request touches exactly one namespace, so every command needs exactly one
// user namespace and one project namespace before it can run. Resolution order,
// highest precedence first:
//
//   1. CLI flags        --user-ns / --project-ns
//   2. Environment      SUPERMEMORY_USER_NS / SUPERMEMORY_PROJECT_NS
//   3. Local project    <repo>/.opencode/memory.local.jsonc   (machine only)
//   4. Project          <repo>/.opencode/memory.jsonc         (committed)
//   5. Global           ~/.config/opencode/supermemory.jsonc  namespaces.user/project
//   6. Built-in defaults
//
// Project files are not trusted: a cloned repository must not be able to point
// the personal memory namespace at a value of its choosing. A `user` value from
// a project file only applies when it equals the global default or appears in
// the trusted allowlist (`namespaces.allowedUserNs` in the global file, or
// SUPERMEMORY_ALLOWED_USER_NS). Project namespaces are constrained to the repo
// itself, so project files may set those freely.
//
// The `opencode-supermemory` plugin does not read project files; it reads
// $HOME/.config/opencode/supermemory.jsonc and auto-captures per git remote.
// This config governs the helper (and the opencode-memory skill) only.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export const NS_PATTERN = /^[a-zA-Z0-9_:-]{1,100}$/;
export const DEFAULT_USER_NS = "opencode:ashley";
export const PROJECT_FILE = join(".opencode", "memory.jsonc");
export const PROJECT_LOCAL_FILE = join(".opencode", "memory.local.jsonc");

const MAX_WALK = 40;
const CONFIG_FILE_NAMES = ["supermemory.jsonc", "supermemory.json"];

export function isValidNamespace(value) {
  return typeof value === "string" && NS_PATTERN.test(value);
}

// Strip // line comments, /* block */ comments, and trailing commas while
// leaving string contents alone. No dependencies, matching the JSONC style of
// the global config file.
export function stripJsonc(source) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (inLine) {
      if (char === "\n") {
        inLine = false;
        out += char;
      }
      continue;
    }
    if (inBlock) {
      if (char === "*" && next === "/") {
        inBlock = false;
        i += 1;
      }
      continue;
    }
    if (inString) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 1;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === "/" && next === "/") {
      inLine = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      inBlock = true;
      i += 1;
      continue;
    }
    out += char;
  }

  return dropTrailingCommas(out);
}

function dropTrailingCommas(source) {
  let out = "";
  let inString = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      out += char;
      if (char === "\\") {
        out += source[i + 1] ?? "";
        i += 1;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
      continue;
    }
    if (char === ",") {
      const rest = source.slice(i + 1);
      const match = rest.match(/^\s*[}\]]/);
      if (match) continue;
    }
    out += char;
  }

  return out;
}

export function readJsoncFile(path) {
  if (!path || !existsSync(path)) return { path, exists: false, value: null, error: null };
  try {
    const text = readFileSync(path, "utf8");
    return { path, exists: true, value: JSON.parse(stripJsonc(text)), error: null };
  } catch (error) {
    return { path, exists: true, value: null, error: error.message };
  }
}

// Walk from `start` towards the filesystem root, returning the first directory
// matching `predicate` (or null). Bounded so a pathological tree cannot loop.
export function findUp(start, predicate, limit = MAX_WALK) {
  let dir = resolve(start);
  for (let i = 0; i < limit; i += 1) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// The git toplevel (`.git` may be a file in worktrees), else the nearest dir
// carrying project memory config, else the current directory.
export function findProjectRoot(start = process.cwd()) {
  const gitRoot = findUp(start, (dir) => existsSync(join(dir, ".git")));
  if (gitRoot) return gitRoot;
  const marker = findUp(
    start,
    (dir) => existsSync(join(dir, PROJECT_FILE)) || existsSync(join(dir, PROJECT_LOCAL_FILE)),
  );
  return marker ?? resolve(start);
}

// Nearest project file between `start` and `root` (inclusive).
function findProjectFile(start, root, relative) {
  let dir = resolve(start);
  const stop = resolve(root);
  for (let i = 0; i < MAX_WALK; i += 1) {
    const candidate = join(dir, relative);
    if (existsSync(candidate)) return candidate;
    if (dir === stop) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

export function slug(value) {
  const cleaned = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || "project";
}

export function defaultProjectNamespace(root) {
  return `project_${slug(basename(resolve(root)))}`;
}

export function configDir(env = process.env) {
  return env.SUPERMEMORY_CONFIG_DIR ? resolve(env.SUPERMEMORY_CONFIG_DIR) : join(homedir(), ".config", "opencode");
}

export function defaultGlobalConfigPath(env = process.env) {
  const dir = configDir(env);
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return join(dir, CONFIG_FILE_NAMES[0]);
}

export function resolveApiKey({ env = process.env, globalConfigPath, credentialsPath } = {}) {
  if (env.SUPERMEMORY_API_KEY) return { value: env.SUPERMEMORY_API_KEY, source: "env" };

  const config = readJsoncFile(globalConfigPath ?? defaultGlobalConfigPath(env));
  if (!config.error && typeof config.value?.apiKey === "string" && config.value.apiKey) {
    return { value: config.value.apiKey, source: config.path };
  }

  const credentials = readJsoncFile(
    credentialsPath ?? join(homedir(), ".supermemory-opencode", "credentials.json"),
  );
  if (!credentials.error && typeof credentials.value?.apiKey === "string" && credentials.value.apiKey) {
    return { value: credentials.value.apiKey, source: credentials.path };
  }

  return { value: null, source: null };
}

function namespacesBlock(file) {
  if (!file.exists || file.error) return {};
  const block = file.value?.namespaces;
  return block && typeof block === "object" && !Array.isArray(block) ? block : {};
}

function allowedUserNamespaces(env, globalBlock) {
  const fromEnv = String(env.SUPERMEMORY_ALLOWED_USER_NS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv.filter(isValidNamespace);

  const configured = globalBlock.allowedUserNs;
  if (!Array.isArray(configured)) return [];
  return configured.filter(isValidNamespace);
}

function isProjectSource(source) {
  return source.startsWith("project:") || source.startsWith("project-local:");
}

/**
 * Resolve the user and project namespaces for one request.
 *
 * @returns {{
 *   user: { value: string, source: string },
 *   project: { value: string, source: string },
 *   projectRoot: string,
 *   allowedUserNs: string[],
 *   trustedUserNs: string,
 *   paths: { global: string, project: string|null, projectLocal: string|null },
 *   warnings: string[],
 * }}
 */
export function resolveNamespaces({
  cwd = process.cwd(),
  env = process.env,
  flags = {},
  globalConfigPath,
  warn = () => {},
} = {}) {
  const warnings = [];
  const report = (message) => {
    warnings.push(message);
    warn(message);
  };

  const projectRoot = findProjectRoot(cwd);
  const projectPath = findProjectFile(cwd, projectRoot, PROJECT_FILE);
  const projectLocalPath = findProjectFile(cwd, projectRoot, PROJECT_LOCAL_FILE);
  const globalPath = globalConfigPath ?? defaultGlobalConfigPath(env);

  const globalFile = readJsoncFile(globalPath);
  const projectFile = projectPath ? readJsoncFile(projectPath) : { path: null, exists: false };
  const projectLocalFile = projectLocalPath ? readJsoncFile(projectLocalPath) : { path: null, exists: false };

  for (const [label, file] of [
    [`global config ${globalFile.path}`, globalFile],
    [`project config ${projectFile.path}`, projectFile],
    [`project-local config ${projectLocalFile.path}`, projectLocalFile],
  ]) {
    if (file.exists && file.error) report(`${label}: ${file.error}; ignoring it`);
  }

  const globalBlock = namespacesBlock(globalFile);
  const projectBlock = namespacesBlock(projectFile);
  const projectLocalBlock = namespacesBlock(projectLocalFile);

  const trustedUserNs = isValidNamespace(globalBlock.user) ? globalBlock.user : DEFAULT_USER_NS;
  const allowedUserNs = allowedUserNamespaces(env, globalBlock);

  const userCandidates = [
    { value: flags.userNs, source: "flag" },
    { value: env.SUPERMEMORY_USER_NS, source: "env" },
    { value: projectLocalBlock.user, source: `project-local:${projectLocalFile.path}` },
    { value: projectBlock.user, source: `project:${projectFile.path}` },
    { value: globalBlock.user, source: `global:${globalFile.path}` },
  ];

  const projectCandidates = [
    { value: flags.projectNs, source: "flag" },
    { value: env.SUPERMEMORY_PROJECT_NS, source: "env" },
    { value: projectLocalBlock.project, source: `project-local:${projectLocalFile.path}` },
    { value: projectBlock.project, source: `project:${projectFile.path}` },
    { value: globalBlock.project, source: `global:${globalFile.path}` },
  ];

  const user = pickCandidate(userCandidates, {
    fallback: { value: trustedUserNs, source: "default" },
    label: "user",
    report,
    // Guardrail: project files cannot redirect the personal namespace unless
    // the trusted config (or env) explicitly allows that value.
    accept: (candidate) => {
      if (!isProjectSource(candidate.source)) return true;
      if (candidate.value === trustedUserNs) return true;
      return allowedUserNs.includes(candidate.value);
    },
    rejected: (candidate) =>
      `user namespace "${candidate.value}" from ${candidate.source} is not in allowedUserNs ` +
      `([${allowedUserNs.join(", ")}]); ignoring it. Add it to namespaces.allowedUserNs in ${globalPath} to permit this.`,
  });

  const project = pickCandidate(projectCandidates, {
    fallback: { value: defaultProjectNamespace(projectRoot), source: "default" },
    label: "project",
    report,
  });

  return {
    user,
    project,
    projectRoot,
    allowedUserNs,
    trustedUserNs,
    paths: { global: globalFile.path, project: projectFile.path, projectLocal: projectLocalFile.path },
    warnings,
  };
}

function pickCandidate(candidates, { fallback, label, report, accept = () => true, rejected }) {
  for (const candidate of candidates) {
    if (candidate.value === undefined || candidate.value === null || candidate.value === "") continue;
    if (!isValidNamespace(candidate.value)) {
      report(
        `${label} namespace ${JSON.stringify(candidate.value)} from ${candidate.source} is invalid ` +
          `(allowed: letters, digits, "_", ":", "-", max 100 chars); ignoring it`,
      );
      continue;
    }
    if (!accept(candidate)) {
      report(rejected ? rejected(candidate) : `${label} namespace from ${candidate.source} is not permitted; ignoring it`);
      continue;
    }
    return { value: candidate.value, source: candidate.source };
  }
  return fallback;
}
