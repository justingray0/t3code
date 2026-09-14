---
name: update-orchestration-v2-fork
description: >
  Reset justingray0/t3code's orchestration-v2-fork onto latest upstream
  orchestration v2, reapply fork-only overlay, and remap live SQLite
  migrations after ID collisions. Use when the user says update
  orchestration-v2-fork, sync the v2 fork, reset onto codex-turn-mapping,
  or rebase orchestration v2 after an upstream force-push. Use when the
  user runs /update-orchestration-v2-fork.
---

# Update orchestration-v2-fork

Do this when the user wants this fork's `orchestration-v2-fork` branch to match latest upstream orchestration v2, then restore fork-only behavior.

## Remotes and upstream branch

- `origin` is `justingray0/t3code`. Push as `justingray0` (`git@github-gray:justingray0/t3code.git` if `github.com` authenticates as the wrong user).
- Upstream is `pingdotgg/t3code`. In this checkout the remote is often named `t3code`, not `upstream`.
- Upstream v2 is **`t3code/codex-turn-mapping`**. There is usually no `orchestration-v2` branch. Fetch that remote and use `t3code/t3code/codex-turn-mapping` (or `upstream/t3code/codex-turn-mapping`).

Do not treat `backup/codex-turn-mapping-pre-rebase-*` as latest. Those are old snapshots.

## Inventory, then reset

1. Fetch origin and the pingdotgg remote.
2. Save a local backup branch of the current `orchestration-v2-fork` tip.
3. Find fork-only work with a **two-dot file diff** against the last _intentionally_ merged upstream v2 snapshot, excluding `.repos`. After upstream force-pushes, commit SHAs will not match; do not use `git log A..B` as the overlay list.
4. Hard-reset `orchestration-v2-fork` onto latest `t3code/codex-turn-mapping`. History on this branch may be discarded.
5. Reapply overlay that is still a unique delta. Source of truth for the checklist is [`CLAUDE.local.md`](../../../CLAUDE.local.md). Tell the user about items that are now upstream or no longer present as a unique delta; do not silently drop a still-needed behavior.
6. If `@cursor/sdk` was bumped, keep `@cursor/` external in `scripts/lib/cli-external-packages.ts` and regenerate only the lockfile entries for that bump (`pnpm install --no-frozen-lockfile`). Do not take an unrelated lockfile wholesale.

## Migration surgery (live `~/.t3`)

Effect's migrator runs only IDs **greater than** the latest row in `effect_sql_migrations`. It does not fill gaps and does not compare names.

Private v2 used to occupy numbered slots that main later filled, then packed remaining v2 into one later ID (currently 48–51 main-line, 52 combined Orchestration V2). After a reset, compare:

- `apps/server/src/persistence/Migrations.ts` on the new tree
- `SELECT migration_id, name FROM effect_sql_migrations ORDER BY 1` on the live DB

If old v2 names sit in IDs that the new manifest uses for different migrations, the new work will be skipped. Then:

1. Stop the process that has `~/.t3/userdata/state.sqlite` open. On this host that is `systemctl --user stop t3code-nix-mini.service`. Kill only a PID you captured or the owner of that unit; never `pkill -f`.
2. `VACUUM INTO` a timestamped backup under `~/.t3/userdata/backups/`.
3. Delete the colliding old v2 rows so latest is the last **shared** main-line ID.
4. Run the new main-line migrations that now occupy those IDs (`runMigrations({ toMigrationInclusive: <last main-line id before combined v2> })`).
5. If the combined v2 migration would `CREATE TABLE` on schema that already exists, **stamp it applied** instead of running it.
6. Confirm the tracking table names match the new manifest through the combined v2 ID.

Do not point a worktree `vp run dev` at live `~/.t3`. Live surgery is only for the running install the user asked to update.

## Rebuild and publish

1. Run `t3code-rebuild` when updating this host's live server. Confirm the unit is active, `:3773` is listening, and HTTP 200. If startup fails, read the unit journal, fix, and rebuild again.
2. Force-push `origin orchestration-v2-fork` only when the user asked. Use `--force-with-lease`.

Do not open a PR against `pingdotgg/t3code` for this overlay.
