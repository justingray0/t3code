# Fork-local notes (justingray0/t3code)

Operational notes specific to this fork. Not tracked upstream. Auto-loaded by
Claude Code alongside `CLAUDE.md`.

## Git remotes / push auth

- `origin` should use the `github-gray` SSH host so pushes authenticate as
  `justingray0` (not `jparkrr`):
  `git@github-gray:justingray0/t3code.git`
- Upstream is `pingdotgg/t3code`. In this checkout the remote is often named
  `t3code`.

## Syncing

- Fork `main`: reset to `upstream/main`, force-push, then re-apply fork-only
  fixes as new PRs (`reapply/*`). Cherry-picking large provider/resume patches
  onto a long gap is usually worse than re-porting.
- Orchestration v2: follow `.agents/skills/update-orchestration-v2-fork/SKILL.md`.

When resolving `pnpm-lock.yaml` during a merge-based sync, never take
upstream's lockfile wholesale if this fork still has a customized
`patches/effect@*.patch`. Regenerate with:

```
pnpm install --lockfile-only --no-frozen-lockfile
```

so `patchedDependencies` hashes match on-disk patches (needed for
`--frozen-lockfile` rebuilds on the mini).
