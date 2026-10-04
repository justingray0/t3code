---
name: update-orchestration-v2-fork
description: >
  Move justingray0/t3code's orchestration-v2-fork onto freshly fetched
  upstream main and reapply the fork-only mobile overlay. Use when the
  user says update orchestration-v2-fork, sync the fork onto main, or
  runs /update-orchestration-v2-fork.
---

# Update orchestration-v2-fork

Do this when the user wants `orchestration-v2-fork` to match latest upstream main, then restore the fork-only mobile overlay.

## Remotes and base

- `origin` is `justingray0/t3code`. Push as `justingray0` (`git@github-gray:justingray0/t3code.git` if `github.com` authenticates as the wrong user).
- Upstream is `pingdotgg/t3code`. Prefer the remote named `upstream`. If it is missing, use `t3code`.
- The sync base is that remote's `main` from a fresh fetch. Do not use local `main`, `origin/main`, or `codex-turn-mapping`. Upstream v2 is merged to main, and main is not rebased.

## Update

1. Fetch the upstream remote.
2. Save a local backup branch of the current `orchestration-v2-fork` tip.
3. Rebase the overlay commit onto the fetched main. If this branch is not overlay commits on an ancestor of that main, hard-reset onto the fetched main and reapply only the overlay below.
4. Leave `~/.t3` alone. Newer migration IDs run at startup.
5. Do not start the server or run `t3code-rebuild` unless the user asks.
6. Push only when the user asks. A history rewrite needs `--force-with-lease`.

Do not open a PR against `pingdotgg/t3code` for this overlay.

## Fork overlay

Reapply only this. Skip anything else.

- **Env-driven EAS identity.** In `apps/mobile/app.config.ts`, read `T3CODE_EAS_PROJECT_ID`, `T3CODE_EAS_OWNER`, `T3CODE_APPLE_TEAM_ID`, and `T3CODE_IOS_BUNDLE_IDENTIFIER` instead of pingdotgg's project id, owner, Apple team, and development bundle id. `loadRepoEnv` already returns those keys from `.env` and `.env.local`. Leave preview and production bundle ids on upstream's values. Main's `T3CODE_IOS_PERSONAL_TEAM` flag only swaps a bundle id, so it does not replace this.
- **Simulator dev client.** Add the `development:simulator` profile to `apps/mobile/eas.json`. Add `apps/mobile/plugins/withIosSimulatorArm64Only.cjs` and register it in `app.config.ts` so EAS simulator builds exclude x86_64 (GhosttyKit is arm64-only). In `apps/mobile/package.json` restore `eas:ios:dev:simulator` and `eas:update:dev` (`APP_VARIANT=development eas update --channel development --environment development`). Do not carry other package.json edits forward.
- **This skill.** Restore `.agents/skills/update-orchestration-v2-fork/` (`SKILL.md` and `agents/openai.yaml`) from the pre-reset backup. Upstream does not carry it.
