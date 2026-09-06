import { describe, expect, it } from "vitest";
import { currentReturnPath, isSafeReturnPath } from "./returnTo";

describe("isSafeReturnPath", () => {
  it("accepts an internal path, with or without a query string", () => {
    expect(isSafeReturnPath("/listing/123")).toBe(true);
    expect(isSafeReturnPath("/search?q=mobile&category=electronics&page=3")).toBe(true);
    expect(isSafeReturnPath("/")).toBe(true);
  });

  // The exact bug this function exists to prevent: a `from`/`returnTo` value
  // is attacker-reachable (a crafted login link, or — for the Google flow —
  // a query param on GET /api/auth/google), so every one of these must be
  // rejected rather than handed to navigate()/res.redirect().
  it("rejects anything that would leave the app's own origin", () => {
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("http://evil.com/listing/123")).toBe(false);
    // Protocol-relative — the browser still treats this as a different origin.
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
    expect(isSafeReturnPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects anything that isn't a non-empty internal path", () => {
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath(null)).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath("listing/123")).toBe(false); // no leading slash
    expect(isSafeReturnPath(42)).toBe(false);
    expect(isSafeReturnPath("/listing\t/evil.com")).toBe(false); // embedded control char
  });
});

describe("currentReturnPath", () => {
  it("joins pathname and search, so filters/sort/page survive the round trip", () => {
    expect(
      currentReturnPath({
        pathname: "/search",
        search: "?q=mobile&category=electronics&sort=price&page=3",
      }),
    ).toBe("/search?q=mobile&category=electronics&sort=price&page=3");
  });

  it("is just the pathname when there is no query string", () => {
    expect(currentReturnPath({ pathname: "/listing/123", search: "" })).toBe(
      "/listing/123",
    );
  });
});
