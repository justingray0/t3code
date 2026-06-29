import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import { it, assert } from "@effect/vitest";

import * as AcpClient from "./client.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

// Regression test for a production hang against the grok agent. After the
// `initialize` response, grok emits unsolicited JSON-RPC responses with the
// symbolic id `"skills-reload"`. Those ids never match a request we issued (the
// RpcClient only mints numeric ids), and forwarding them to the RpcClient made
// it tear down its response loop, so the subsequent `authenticate` and
// `session/new` responses were never delivered and the handshake stalled until
// the caller timed out. The protocol layer must drop such untracked,
// non-numeric responses instead.

const encoder = new TextEncoder();

const skillsReloadResponse = `${JSON.stringify({
  jsonrpc: "2.0",
  id: "skills-reload",
  result: { result: { reloaded: 0 } },
})}\n`;

const extNotification = `${JSON.stringify({
  jsonrpc: "2.0",
  method: "_x.ai/mcp/servers_updated",
  params: { mcpServers: [] },
})}\n`;

const responseFor = (id: unknown, result: unknown) =>
  `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`;

it.effect(
  "completes initialize/authenticate/session despite untracked skills-reload responses",
  () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const push = (line: string) => Queue.offer(input, encoder.encode(line));

      // Fake grok peer: answer each request and, right after `initialize`,
      // flood the stream with untracked `skills-reload` responses like grok.
      const peer = yield* Effect.forkScoped(
        Effect.forever(
          Queue.take(output).pipe(
            Effect.flatMap((chunk) =>
              Effect.forEach(
                chunk.split("\n").filter((line) => line.trim().length > 0),
                (line) => {
                  const message = JSON.parse(line) as { id?: unknown; method?: string };
                  if (message.method === "initialize") {
                    return push(responseFor(message.id, { protocolVersion: 1 })).pipe(
                      Effect.andThen(
                        Effect.forEach([1, 2, 3, 4, 5], () => push(skillsReloadResponse), {
                          discard: true,
                        }),
                      ),
                      Effect.andThen(push(extNotification)),
                    );
                  }
                  if (message.method === "authenticate") {
                    return push(responseFor(message.id, {}));
                  }
                  if (message.method === "session/new") {
                    return push(responseFor(message.id, { sessionId: "mock-session-1" }));
                  }
                  return Effect.void;
                },
                { discard: true },
              ),
            ),
          ),
        ),
      );

      const result = yield* Effect.gen(function* () {
        const acp = yield* AcpClient.AcpClient;
        const init = yield* acp.agent.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
        });
        assert.equal(init.protocolVersion, 1);
        yield* acp.agent.authenticate({ methodId: "cached_token" });
        const session = yield* acp.agent.createSession({ cwd: "/tmp", mcpServers: [] });
        return session.sessionId;
      }).pipe(Effect.provide(AcpClient.layer(stdio)), Effect.timeout("5 seconds"));

      assert.equal(result, "mock-session-1");
      yield* Fiber.interrupt(peer);
    }).pipe(Effect.scoped),
  { timeout: 15_000 },
);
