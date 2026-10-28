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
- `skills/` — globally available agent skills (`docker-pro`, `github-actions-workflow-pro`).

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

## Notes

- Plugins are pinned (`opencode-supermemory@2.0.17`, `cc-safety-net@2.7.0`) so background updates cannot change them; update deliberately and restart with `opencode reload`.
- `permissions` asks before edits and before access outside the active project. Shell commands are additionally screened by `cc-safety-net` for destructive operations and secret access.
- Skills under `skills/` are discovered automatically; no config entry is needed.
