import { describe, expect, it } from "vitest";

import {
  RELAY_AXIOM_TRACE_DATASET,
  relayAxiomIngestDatasetCapabilities,
  relayAxiomQueryDatasetCapabilities,
  relayTraceQuery,
} from "./RelayObservability.ts";

describe("RelayObservability", () => {
  it("scopes the ingest token only to HTTP span ingestion", () => {
    expect(relayAxiomIngestDatasetCapabilities()).toEqual({
      [RELAY_AXIOM_TRACE_DATASET]: { ingest: ["create"] },
    });
  });

  it("scopes the diagnostics query token only to HTTP spans", () => {
    expect(relayAxiomQueryDatasetCapabilities()).toEqual({
      [RELAY_AXIOM_TRACE_DATASET]: { query: ["read"] },
    });
  });

  it("builds APL queries for the trace dataset", () => {
    expect(relayTraceQuery("| where name == 'GET /health'", "relay-traces-test")).toBe(
      "['relay-traces-test']\n| where name == 'GET /health'",
    );
  });
});
