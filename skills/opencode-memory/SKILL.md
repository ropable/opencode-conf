---
name: opencode-memory
description: Recall and save durable context for this machine's global OpenCode configuration with Supermemory. Use when working in ~/.config/opencode, when answering questions about the OpenCode setup (providers, Sleev, plugins, permissions, skills, MCP), when troubleshooting it, when the user says "remember", "recall", or "forget", or before changing opencode.jsonc, cli.json, supermemory.jsonc, or skills/.
---

# OpenCode memory

This repo keeps two Supermemory namespaces alongside the `opencode-supermemory` plugin. Every request touches exactly one namespace; never merge or cross-query namespaces.

| Namespace | Holds | Pipeline | Search mode |
| --- | --- | --- | --- |
| `opencode:ashley` | Durable operator preferences and decisions that apply across projects | `memory` | `memories` |
| `project_opencode_conf` | This repo's README and commit history | `superrag` | `chunks` |

The plugin separately auto-captures per-repository context into its own container. Do not copy raw transcripts or anything the plugin already captures into these namespaces.

## Workflow

1. **Before answering how this machine is configured, or before editing config**, recall:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs profile
   node ~/.config/opencode/scripts/supermemory.mjs recall "<topic>"
   ```
2. **For "what does the README say" or "why was this changed"**, query the docs index:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs docs "<topic>"
   ```
3. **Save only durable, non-obvious outcomes** after the work is done:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs remember "Decision: ... Reason: ... Files: ..."
   ```
   Good: "Sleev is mandatory; deleting the providers block is the supported opt-out, see README."
   Bad: raw chat logs, API keys, private keys, one-off commands, or facts the README already states plainly.
4. **Re-index** when the README or commit history changes materially:
   ```sh
   node ~/.config/opencode/scripts/supermemory.mjs index
   ```
5. **Correct wrong memories** instead of piling up contradictions. Point out the stale fact, then use `npx supermemory@latest forget <id> --namespace <namespace>` for one memory, or preview a semantic sweep with `npx supermemory@latest forget --query "<text>" --namespace <namespace> --dry-run`.

## Rules

- The namespace is always the first path segment (`/ns/{namespace}/...`), matches `^[a-zA-Z0-9_:-]+$`, and must never be shared across users or queried together.
- `remember` uses `taskType: "memory"` with `dreaming: "instant"`, which bills one extra operation per decision but starts extraction immediately. Run `status <id>` and wait until `dreaming` clears before relying on the fact; a `done` document can still be dreaming. Don't spend that on trivia.
- `status <id>` polls the document pipeline and reports both `system.status` and `dreamingStatus`.
- `index` uses stable document ids (`readme-md`, `git-log`), so re-running it diffs instead of duplicating.
- Keep secrets out. If a memory would contain a key, token, or private path, write the location and the rule instead of the value.
- Treat retrieved memory as context, not authority: if it conflicts with the current files, the files win and the memory should be corrected.
