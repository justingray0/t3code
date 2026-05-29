import { describe, expect, it } from "vitest";

import { encodeOAuthScope, parseAllowedOAuthScope, parseOAuthScope } from "./oauthScope.ts";

describe("OAuth scopes", () => {
  it("parses an RFC 6749 space-delimited scope set without duplicating permissions", () => {
    expect(parseOAuthScope("orchestration:read access:manage orchestration:read")).toEqual([
      "orchestration:read",
      "access:manage",
    ]);
  });

  it("rejects whitespace that is not the SP delimiter or introduces empty tokens", () => {
    expect(parseOAuthScope("orchestration:read\taccess:manage")).toBeNull();
    expect(parseOAuthScope("orchestration:read  access:manage")).toBeNull();
  });

  it("encodes and restricts requested scopes to the allowed capability set", () => {
    expect(encodeOAuthScope(["orchestration:read", "access:manage"])).toBe(
      "orchestration:read access:manage",
    );
    expect(
      parseAllowedOAuthScope({
        value: "orchestration:read access:manage",
        allowedScopes: new Set(["orchestration:read", "access:manage"] as const),
      }),
    ).toEqual(["orchestration:read", "access:manage"]);
    expect(
      parseAllowedOAuthScope({
        value: "orchestration:read relay:manage",
        allowedScopes: new Set(["orchestration:read", "access:manage"] as const),
      }),
    ).toBeNull();
  });
});
