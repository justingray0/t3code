# Fork-local notes (justingray0/t3code)

Operational notes specific to this fork. Not tracked upstream, so it never
conflicts when syncing `upstream/main`. Auto-loaded by Claude Code alongside
`CLAUDE.md` — keep it to fork-specific gotchas, not general project docs.

## Git remotes / push auth

- `origin` should use the `github-gray` SSH host so pushes authenticate as
  `justingray0` (not `jparkrr`):
  `git@github-gray:justingray0/t3code.git`
- `upstream` is `pingdotgg/t3code`.

## Syncing upstream

Preferred: reset fork `main` to `upstream/main`, force-push, then re-apply
fork-only fixes as new PRs (see reapply/\* branches). Cherry-picking large
provider/resume patches onto a 400+ commit gap is usually worse than re-porting.

When resolving `pnpm-lock.yaml` conflicts during a merge-based sync, never take
upstream's lockfile wholesale if this fork still has a customized
`patches/effect@*.patch` — regenerate with:

```
pnpm install --lockfile-only --no-frozen-lockfile
```

so `patchedDependencies` hashes match on-disk patches (needed for
`--frozen-lockfile` rebuilds on the mini).

## Fork-only behaviors to re-check after sync

- Tailscale Serve ⇒ `remote-reachable` auth even on loopback bind
- Drop non-numeric untracked ACP responses (Grok `skills-reload`)
- Codex standalone installer: `codex update` native path (now upstream on `t3code/codex-turn-mapping`)
- Cursor Fast Mode default off
- Grok: discard resume cursor when thread cwd/worktree changes
- Cursor/ACP session resume + provider session recovery (if still missing)
- GitHub Actions workflows disabled on this fork
