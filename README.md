```text
 ██████╗ ██████╗ ███████╗███╗   ██╗ ██████╗ ██████╗ ██████╗ ███████╗
██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔════╝██╔═══██╗██╔══██╗██╔════╝
██║   ██║██████╔╝█████╗  ██╔██╗ ██║██║     ██║   ██║██║  ██║█████╗
██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║     ██║   ██║██║  ██║██╔══╝
╚██████╔╝██║     ███████╗██║ ╚████║╚██████╗╚██████╔╝██████╔╝███████╗
 ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝

    ██████╗ ██████╗ ███╗   ██╗███████╗██╗ ██████╗
   ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║██╔════╝
   ██║     ██║   ██║██╔██╗ ██║█████╗  ██║██║  ███╗
   ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║██║   ██║
   ╚██████╗╚██████╔╝██║ ╚████║██║     ██║╚██████╔╝
    ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝
```

# Overview

This repository holds this machine's global OpenCode configuration:

- `opencode.jsonc` — server configuration: pinned plugins, permissions, compaction, and the providers routed through Sleev.
- `cli.json` — terminal client settings (theme, cursor, diff wrapping).
- `skills/` — globally available agent skills (`docker-pro`, `github-actions-workflow-pro`, `opencode-memory`).
- `scripts/supermemory.mjs` — zero-dependency helper for the Supermemory namespaces described in [Project memory](#project-memory); `scripts/lib/namespaces.mjs` resolves them per project.

**Sleev is required.** Both configured providers (`opencode` and `opencode-go`) send model requests through the local Sleev gateway at `http://127.0.0.1:17321`. If the gateway is not running, model requests fail. See [Optional: disable the Sleev requirement](#optional-disable-the-sleev-requirement) to run without it.

## Requirements

- **OpenCode v2** — <https://opencode.ai/v2/docs/>
- **Sleev** CLI and local gateway — <https://sleev.ai/docs/quickstart/install>
- **OpenCode Go** account — for provider authentication and the model catalog
- Optional: **Supermemory API key** in `~/.config/opencode/supermemory.jsonc` — without it, the `opencode-supermemory` plugin loads but its hooks stay disabled

## Installation

1. **Install OpenCode v2** — <https://opencode.ai/v2/docs/>.

2. **Install Sleev**:

   ```sh
   curl -fsSL https://sleev.ai/install.sh | bash
   ```

   Or, with npm (requires Node.js 22+): `npm install -g sleev`.

3. **Set up the gateway**:

   ```sh
   sleev auth login        # optional; account-free mode is available
   sleev setup             # registers this machine, installs and starts the gateway
   sleev gateway status    # expect "running": true, "healthy": true
   ```

4. **Clone this repository** to `~/.config/opencode`:

   ```sh
   git clone https://github.com/ropable/opencode-conf.git ~/.config/opencode
   ```

   If the directory already exists, copy the files there instead.

5. **Confirm Sleev routes both providers**:

   ```sh
   sleev harness opencode enable opencode
   sleev harness opencode enable opencode-go
   sleev harness opencode list
   ```

   Both providers should show as enabled. The committed `providers` block already contains the routing, so this step mainly verifies or repairs it.

6. **Optional: enable Supermemory** (persistent memory across sessions):

   ```sh
   cat > ~/.config/opencode/supermemory.jsonc <<'EOF'
   {
     // Create a key at https://console.supermemory.ai
     "apiKey": "sm_your_key_here"
   }
   EOF
   chmod 600 ~/.config/opencode/supermemory.jsonc
   ```

   The file is already listed in this repository's `.gitignore`, so the key is never committed. The plugin reads it from `~/.config/opencode` even when `OPENCODE_CONFIG_DIR` is set.

   Alternatives: `bunx opencode-supermemory@latest login` writes `~/.supermemory-opencode/credentials.json`, or set `SUPERMEMORY_API_KEY` in the environment that launches OpenCode. Lookup order is environment → `supermemory.jsonc` → credentials file.

7. **Start OpenCode** and authenticate with OpenCode Go:

   ```sh
   opencode
   ```

The Sleev gateway must be running before OpenCode sends a request. Check it with `sleev gateway status` after a reboot or a `sleev upgrade`; restart it with `systemctl --user restart sleeve-gateway` if it is unhealthy.

### Applying configuration changes

`cli.json` reloads live in the TUI. After editing `opencode.jsonc` or adding `supermemory.jsonc`, run `opencode reload` (or `/reload`) — the file watcher does not always pick up changes. Confirm Supermemory with `bunx opencode-supermemory@latest status`; if the config still looks stale, run `opencode service restart`.

## Optional: disable the Sleev requirement

Either approach below returns OpenCode to its normal provider endpoints, after which Sleev does not need to be installed or running.

### Use Sleev's own toggle (recommended)

```sh
sleev harness opencode disable --all
opencode reload
```

Re-enable later with:

```sh
sleev harness opencode enable opencode
sleev harness opencode enable opencode-go
opencode reload
```

These commands rewrite `~/.config/opencode/opencode.jsonc`, which is tracked by this repository. Review the change with `git diff`; discard it with `git checkout -- opencode.jsonc`.

### Remove the provider overrides manually

Delete the `providers` block from `opencode.jsonc`, then run `opencode reload`. Without those overrides, OpenCode uses its usual Console provider endpoints and does not contact Sleev.

Leave the removal uncommitted if you want the option to switch back, or commit it if you no longer intend to use Sleev.

## Project memory

Two Supermemory namespaces complement the `opencode-supermemory` plugin. Each request touches exactly one namespace, and the namespace is always the first path segment (`/ns/{namespace}/...`).

| Namespace | Purpose | Pipeline | Search mode |
| --- | --- | --- | --- |
| `opencode:ashley` | Durable operator preferences and decisions that apply across projects | `memory` | `memories` |
| `project_<repo>` | Per-repository docs index, e.g. `project_opencode_conf` for this repo | `superrag` | `chunks` |

The helper resolves both namespaces per project, highest precedence first:

1. `--user-ns` / `--project-ns` flags
2. `SUPERMEMORY_USER_NS` / `SUPERMEMORY_PROJECT_NS`
3. `<repo>/.opencode/memory.local.jsonc` (machine only)
4. `<repo>/.opencode/memory.jsonc` (committed)
5. `~/.config/opencode/supermemory.jsonc` → `namespaces.user` / `namespaces.project`
6. Defaults: `opencode:ashley` and `project_<repo>`

Resolution walks up from the working directory to the git toplevel, so a command run in `referral/` still resolves the repository's file. Show the effective values and where each came from:

```sh
node scripts/supermemory.mjs config          # human readable
node scripts/supermemory.mjs config --json   # machine readable
```

A project file only needs the field it changes; the local file overrides the committed one field by field:

```jsonc
// <repo>/.opencode/memory.jsonc
{ "namespaces": { "project": "project_prs" } }
```

```jsonc
// <repo>/.opencode/memory.local.jsonc — keep out of version control
{ "namespaces": { "user": "opencode:ashley:work" } }
```

**Guardrail.** A project file is repository-supplied input, so it cannot redirect the personal namespace on its own. A `user` value from a project file applies only when it matches the global default or appears in `namespaces.allowedUserNs` in `supermemory.jsonc` (or in `SUPERMEMORY_ALLOWED_USER_NS`). Anything else is ignored with a warning. Project namespaces are repo-scoped, so project files may set those freely.

Prefer setting only `project` per repository. A per-repository *user* namespace fragments durable preferences — a fact learned in one repository is invisible in the next — so reserve it for a deliberate work/personal split.

```sh
node scripts/supermemory.mjs profile
node scripts/supermemory.mjs recall "provider routing"
node scripts/supermemory.mjs remember "Decision: ... Reason: ... Files: ..."
node scripts/supermemory.mjs index    # re-ingest this README + git log
node scripts/supermemory.mjs docs "gateway restart"
node scripts/supermemory.mjs status <id>
```

`remember` uses instant extraction (one extra operation per decision) so a saved fact starts processing immediately; `status <id>` reports when the document is `done` and whether `dreaming` has cleared. `index` uses stable document ids, so re-running it diffs instead of duplicating. `index` only covers this repository and refuses to run elsewhere.

The script calls the v5 HTTP API directly and resolves the key from `SUPERMEMORY_API_KEY`, `supermemory.jsonc`, or the plugin credentials file. It is deliberately dependency-free: this repository gitignores `package.json`, so there is no local package project to install the official SDK into. The `opencode-memory` skill tells the agent when to use each namespace. Resolution and the guardrail are covered by `node --test scripts/namespaces.test.mjs`.

The plugin does not read project files: it reads `~/.config/opencode/supermemory.jsonc` and auto-captures per git remote. Project namespace files govern the helper and skill only.

## Notes

- Plugins are pinned (`opencode-supermemory@2.0.17`, `cc-safety-net@2.7.0`) so background updates cannot change them; update deliberately and restart with `opencode reload`.
- `permissions` asks before edits and before access outside the active project. Shell commands are additionally screened by `cc-safety-net` for destructive operations and secret access.
- Skills under `skills/` are discovered automatically; no config entry is needed.
