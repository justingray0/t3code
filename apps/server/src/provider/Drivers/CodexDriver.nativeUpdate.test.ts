// @effect-diagnostics nodeBuiltinImport:off
import { expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import {
  makePackageManagedProviderMaintenanceResolver,
  resolveProviderMaintenanceCapabilitiesEffect,
} from "../providerMaintenance.ts";
import { isCodexNativeCommandPath } from "./CodexDriver.ts";

const DRIVER_KIND = ProviderDriverKind.make("codex");
const codexUpdate = makePackageManagedProviderMaintenanceResolver({
  provider: DRIVER_KIND,
  npmPackageName: "@openai/codex",
  homebrewFormula: "codex",
  nativeUpdate: {
    executable: "codex",
    args: ["update"],
    lockKey: "codex-native",
    isCommandPath: isCodexNativeCommandPath,
  },
});

const makeTempDir = (name: string) =>
  Crypto.Crypto.pipe(
    Effect.flatMap((crypto) => crypto.randomUUIDv4),
    Effect.map((id) => NodePath.join(NodeOS.tmpdir(), `${name}-${id}`)),
  );

it("recognizes the official Codex install.sh paths", () => {
  expect(isCodexNativeCommandPath("/home/me/.local/bin/codex")).toBe(true);
  expect(isCodexNativeCommandPath("/Users/me/.local/bin/codex")).toBe(true);
  expect(isCodexNativeCommandPath("C:\\Users\\me\\.local\\bin\\codex.exe")).toBe(true);
  expect(isCodexNativeCommandPath("/home/me/.codex/packages/standalone/current/bin/codex")).toBe(
    true,
  );
  expect(
    isCodexNativeCommandPath(
      "/home/me/.codex/packages/standalone/releases/0.144.1-x86_64-unknown-linux-musl/bin/codex",
    ),
  ).toBe(true);
});

it("rejects npm and Homebrew Codex installs", () => {
  expect(isCodexNativeCommandPath("/opt/homebrew/bin/codex")).toBe(false);
  expect(isCodexNativeCommandPath("/usr/local/bin/codex")).toBe(false);
  expect(isCodexNativeCommandPath("/home/me/.nvm/versions/node/v22.0.0/bin/codex")).toBe(false);
  expect(
    isCodexNativeCommandPath(
      "/home/me/.nvm/versions/node/v22.0.0/lib/node_modules/@openai/codex/bin/codex.js",
    ),
  ).toBe(false);
});

it.layer(NodeServices.layer)("CodexDriver native update", (it) => {
  it.effect(
    "selects `codex update` when the binary resolves through the standalone installer",
    () =>
      Effect.gen(function* () {
        const tempDir = yield* makeTempDir("t3-codex-native-capabilities");
        const localBinDir = NodePath.join(tempDir, ".local", "bin");
        const releaseBinDir = NodePath.join(
          tempDir,
          ".codex",
          "packages",
          "standalone",
          "releases",
          "0.144.1-x86_64-unknown-linux-musl",
          "bin",
        );
        NodeFS.mkdirSync(localBinDir, { recursive: true });
        NodeFS.mkdirSync(releaseBinDir, { recursive: true });
        const releaseCodexPath = NodePath.join(releaseBinDir, "codex");
        NodeFS.writeFileSync(releaseCodexPath, "#!/bin/sh\n");
        NodeFS.chmodSync(releaseCodexPath, 0o755);
        NodeFS.symlinkSync(releaseCodexPath, NodePath.join(localBinDir, "codex"));

        const capabilities = yield* resolveProviderMaintenanceCapabilitiesEffect(codexUpdate, {
          binaryPath: "codex",
          env: {
            PATH: localBinDir,
          },
        }).pipe(Effect.provideService(HostProcessPlatform, "linux"));

        expect(capabilities).toEqual({
          provider: DRIVER_KIND,
          packageName: "@openai/codex",
          update: {
            command: "codex update",
            executable: "codex",
            args: ["update"],
            lockKey: "codex-native",
          },
        });
      }),
  );
});
