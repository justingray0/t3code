---
name: update
description: >
  Keep justingray0/t3code's main current with pingdotgg/t3code main.
  Use when the user says update main, sync with upstream, or runs /update.
---

# Update

Do this when the user wants our `main` brought up to date with upstream `main`.

## Remotes

- `origin` is `justingray0/t3code`. Push as `justingray0` (`git@github-gray:justingray0/t3code.git` if `github.com` authenticates as the wrong user).
- Upstream is `pingdotgg/t3code`. Prefer the remote named `upstream`. If it is missing, use `t3code`.
- Merge that remote's freshly fetched `main` into our `main`.

## Update

1. Fetch the upstream remote.
2. Check out our `main` and save a local backup branch of its tip.
3. Merge the fetched upstream `main` into our `main`.
4. Keep the changes listed below. When one of those files conflicts, preserve that behavior and take upstream's other updates in the same file.
5. Do not start the server or run `t3code-rebuild` unless the user asks.
6. Push only when the user asks.

Do not open a pull request against `pingdotgg/t3code` for our changes.

## Our changes

These are the differences our `main` keeps. Preserve them across the merge. Do not preserve other differences from upstream.

- **Env-driven EAS identity.** In `apps/mobile/app.config.ts`, read `T3CODE_EAS_PROJECT_ID`, `T3CODE_EAS_OWNER`, `T3CODE_APPLE_TEAM_ID`, and `T3CODE_IOS_BUNDLE_IDENTIFIER` instead of pingdotgg's project id, owner, Apple team, and development bundle id. `loadRepoEnv` already returns those keys from `.env` and `.env.local`. Leave preview and production bundle ids on upstream's values. Main's `T3CODE_IOS_PERSONAL_TEAM` flag only swaps a bundle id, so it does not replace this.
- **Simulator dev client.** `apps/mobile/eas.json` has a `development:simulator` profile. `apps/mobile/plugins/withIosSimulatorArm64Only.cjs` is registered in `app.config.ts` so EAS simulator builds exclude x86_64 (GhosttyKit is arm64-only). `apps/mobile/package.json` has `eas:ios:dev:simulator` and `eas:update:dev` (`APP_VARIANT=development eas update --channel development --environment development`). Those two scripts are the package.json changes.
- **This skill.** `.agents/skills/update/` (`SKILL.md` and `agents/openai.yaml`). Upstream does not carry it.
