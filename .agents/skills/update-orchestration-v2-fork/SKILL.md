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
5. Reapply the overlay below. Skip anything else. If an item on the list looks unnecessary on the new tree, confirm with the user and then remove it from this list before dropping it.

## Fork overlay still required

Re-port these after every reset. They are not on `t3code/codex-turn-mapping`.

- **Tailscale Serve auth.** `apps/server/src/auth/EnvironmentAuthPolicy.ts` (and its test). `--tailscale-serve` keeps `config.host` on loopback, so without `config.tailscaleServeEnabled || isRemoteReachableHost(...)` the server uses `loopback-browser` auth and tailnet clients cannot pair.
- **Disabled GitHub Actions.** Rename every `.github/workflows/*.yml` to `*.yml.disabled`. This fork must not run pingdotgg workflows.
- **Cursor SDK on disk, not inlined.** Pin a working `@cursor/sdk` in `apps/server/package.json` (currently 1.0.31; upstream is often older). Add `"@cursor/"` to `CLI_RUNTIME_EXTERNAL_PREFIXES` in `scripts/lib/cli-external-packages.ts` plus the matching tests. Inlining the SDK rewrites its webpack chunk imports to files the bundle never emits, so `Cursor.models.list` / `Cursor.me` fail with `ERR_MODULE_NOT_FOUND`. After a version bump, regenerate only that lockfile slice (`pnpm install --no-frozen-lockfile`).
- **Env-driven EAS / simulator dev client.** `apps/mobile/app.config.ts`, `eas.json`, `package.json`, and `plugins/withIosSimulatorArm64Only.cjs`. Read `T3CODE_EAS_PROJECT_ID`, `T3CODE_EAS_OWNER`, `T3CODE_APPLE_TEAM_ID`, and `T3CODE_IOS_BUNDLE_IDENTIFIER` instead of pingdotgg IDs; add the `development:simulator` profile and exclude x86_64 simulator arch so GhosttyKit (arm64-only) still copies on EAS simulator builds.
- **Browser tab title.** `apps/web/src/routes/__root.tsx` uses `APP_BASE_NAME` for `document.title` and the head title, not `APP_DISPLAY_NAME` / the nightly stage label.
- **`*.a binary` in `.gitattributes`.** `text=auto` would corrupt vendored static libraries.

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
