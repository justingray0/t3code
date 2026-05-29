import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Layer from "effect/Layer";
import { FetchHttpClient } from "effect/unstable/http";

import { remoteHttpClientLayer } from "@t3tools/client-runtime";

export const remoteHttpRuntime = ManagedRuntime.make(remoteHttpClientLayer(globalThis.fetch));

export const primaryHttpRuntime = ManagedRuntime.make(
  Layer.mergeAll(
    remoteHttpClientLayer(globalThis.fetch),
    Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" }),
  ),
);
