---
description: Fetch remotes, sync with upstream/main, and merge Dependabot [actions] PRs
agent: build
---

Maintain GitHub Actions dependency updates for this repository.

Target remote: `$1` when provided, otherwise `upstream` if it exists, otherwise `origin`.
Target branch: `<remote>/main`. Run this on the local `main` branch; stop and report if HEAD is not `main`.

## 1. Fetch and sync

- Run `git fetch --all --prune`.
- Stop and report if `git status --porcelain --untracked-files=no` is non-empty. Untracked files are acceptable.
- Run `git merge --no-edit <remote>/main`. Already up to date is fine. Never resolve conflicts silently: stop and report them.

## 2. Find candidate PRs

Resolve the upstream GitHub repo from the remote, then list open Dependabot PRs:

```sh
gh repo view "$(git remote get-url <remote>)" --json nameWithOwner --jq .nameWithOwner
gh pr list --repo <owner>/<repo> --state open --author app/dependabot \
  --json number,title,headRefName,mergeable,mergeStateStatus,isDraft \
  --jq '.[] | select((.title | ascii_downcase) | startswith("[actions]"))'
```

Keep only non-draft PRs whose title starts with `[actions]` (case-insensitive). Ignore `[python]`, `[docker]`, and every other prefix. Sort by PR number.

## 3. Merge each PR

For each candidate, in ascending number order:

1. Review `gh pr diff <number>`. Accept only a bump of a GitHub Action reference (version and/or pinned SHA) in `.github/workflows/` or `action.yml`. Skip and report any PR that touches application code, adds scripts, or changes unrelated files.
2. Require `mergeable == "MERGEABLE"`. If checks are pending, run `gh pr checks <number> --watch --interval 30`. Skip the PR and report why if checks fail or the PR is not mergeable.
3. Merge with a merge commit: `gh pr merge <number> --repo <owner>/<repo> --merge`.
4. Confirm `gh pr view <number> --json state --jq .state` is `MERGED`, then `git fetch <remote> --prune` before the next PR.

Never push, force-push, or delete branches. Never merge a PR authored by anyone other than `app/dependabot`.

## 4. Resync and report

- Run `git fetch <remote> --prune && git merge --no-edit <remote>/main`.
- Report a table of PR, action bump, and merge commit SHA. List skipped PRs with reasons, and note any local commits not yet on `<remote>/main`.
