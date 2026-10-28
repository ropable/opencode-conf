---
name: opencode-memory
description: Recall and save durable context with Supermemory using this machine's per-project namespaces. Use when answering questions about the OpenCode setup (providers, Sleev, plugins, permissions, skills, MCP), when troubleshooting it, when the user says "remember", "recall", or "forget", before changing opencode.jsonc, cli.json, supermemory.jsonc, or skills/, and whenever memory should stay scoped to the current repository.
---

# OpenCode memory

Supermemory namespaces resolved per project. Every request touches exactly one namespace; never merge or cross-query namespaces.

| Namespace | Holds | Pipeline | Search mode |
| --- | --- | --- | --- |
| `opencode:ashley` | Durable operator preferences and decisions that apply across projects | `memory` | `memories` |
| `opencode:ashley:work` | Optional work split; only reachable through the `allowedUserNs` guardrail | `memory` | `memories` |
| `project_<repo>` | That repository's docs index (`project_opencode_conf` for this config repo) | `superrag` | `chunks` |

## Resolving namespaces

Ask the helper instead of assuming:

```sh
node ~/.config/opencode/scripts/supermemory.mjs config
```

Precedence, highest first: `--user-ns`/`--project-ns` flags, `SUPERMEMORY_USER_NS`/`SUPERMEMORY_PROJECT_NS`, `<repo>/.opencode/memory.local.jsonc`, `<repo>/.opencode/memory.jsonc`, `~/.config/opencode/supermemory.jsonc`, defaults (`opencode:ashley`, `project_<repo>`).

Run the helper from the project you are working in, or any subdirectory of it: resolution walks up to the git toplevel. Never pass a namespace that `config` did not report unless the user asks for it explicitly.

The guardrail only lets a project file set the `user` namespace when the value equals the global default or is listed in `namespaces.allowedUserNs` (global config) or `SUPERMEMORY_ALLOWED_USER_NS`. If `config` warns that it ignored a project namespace, surface that to the user rather than working around it with flags.

If a repository has no `.opencode/memory.jsonc` and the resolved project namespace is a generic `project_<repo>`, propose adding the file instead of exporting env vars.

## Workflow

1. **Before answering how this machine is configured, or before editing config**, recall:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs config
   node ~/.config/opencode/scripts/supermemory.mjs profile
   node ~/.config/opencode/scripts/supermemory.mjs recall "<topic>"
   ```
2. **For "what does the README say" or "why was this changed"**, query the docs index (only the config repo has one):
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs docs "<topic>"
   ```
3. **Save only durable, non-obvious outcomes** after the work is done:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs remember "Decision: ... Reason: ... Files: ..."
   ```
   Good: "Sleev is mandatory; deleting the providers block is the supported opt-out, see README."
   Bad: raw chat logs, API keys, private keys, one-off commands, or facts the README already states plainly.
4. **Re-index** when the README or commit history changes materially. This only works from `~/.config/opencode`; `index` refuses elsewhere:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs index
   ```
5. **Correct wrong memories** instead of piling up contradictions. Point out the stale fact, then use `npx supermemory@latest forget <id> --namespace <namespace>` for one memory, or preview a semantic sweep with `npx supermemory@latest forget --query "<text>" --namespace <namespace> --dry-run`.

## Rules

- One namespace per request; never query or merge two namespaces in one answer.
- Keep the split honest: employer or other work material goes only to the work user namespace, personal decisions go to `opencode:ashley`, and project docs go to that repo's project namespace.
- The namespace is always the first path segment (`/ns/{namespace}/...`) and matches `^[a-zA-Z0-9_:-]{1,100}$`.
- `remember` uses `taskType: "memory"` with `dreaming: "instant"`, which bills one extra operation per decision but starts extraction immediately. Run `status <id>` and wait until `dreaming` clears before relying on the fact; a `done` document can still be dreaming. Don't spend that on trivia.
- `status <id>` polls the document pipeline and reports both `system.status` and `dreamingStatus`.
- `index` uses stable document ids (`readme-md`, `git-log`), so re-running it diffs instead of duplicating.
- Keep secrets out. If a memory would contain a key, token, or private path, write the location and the rule instead of the value.
- Treat retrieved memory as context, not authority: if it conflicts with the current files, the files win and the memory should be corrected.
- The plugin does not read project files; it reads `~/.config/opencode/supermemory.jsonc` and auto-captures per git remote. Project namespace files govern this helper only.
