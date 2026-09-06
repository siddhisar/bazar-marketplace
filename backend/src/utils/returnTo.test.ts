import { describe, expect, it } from "vitest";
import { isSafeReturnPath, withAuthMarker } from "./returnTo";

describe("isSafeReturnPath", () => {
  it("accepts an internal path, with or without a query string", () => {
    expect(isSafeReturnPath("/listing/123")).toBe(true);
    expect(isSafeReturnPath("/search?q=mobile&category=electronics&page=3")).toBe(true);
  });

  // This is what stands between a `returnTo` query param on
  // GET /api/auth/google and an open redirect out of the OAuth callback —
  // see getGoogleStart/getGoogleCallback in auth.controller.ts.
  it("rejects anything that would leave the app's own origin", () => {
    expect(isSafeReturnPath("https://evil.com")).toBe(false);
    expect(isSafeReturnPath("http://evil.com/listing/123")).toBe(false);
    expect(isSafeReturnPath("//evil.com")).toBe(false);
    expect(isSafeReturnPath("/\\evil.com")).toBe(false);
  });

  it("rejects anything that isn't a non-empty internal path", () => {
    expect(isSafeReturnPath(undefined)).toBe(false);
    expect(isSafeReturnPath("")).toBe(false);
    expect(isSafeReturnPath("listing/123")).toBe(false);
    expect(isSafeReturnPath(42)).toBe(false);
  });
});

describe("withAuthMarker", () => {
  it("adds the marker to a path with no existing query string", () => {
    expect(withAuthMarker("/home", "google_ok")).toBe("/home?auth=google_ok");
  });

  it("preserves an existing query string rather than clobbering it", () => {
    expect(
      withAuthMarker("/search?q=mobile&category=electronics&page=3", "google_ok"),
    ).toBe("/search?q=mobile&category=electronics&page=3&auth=google_ok");
  });

  it("adds a reason alongside the marker when given one", () => {
    expect(withAuthMarker("/home", "google_failed", "invalid_grant")).toBe(
      "/home?auth=google_failed&reason=invalid_grant",
    );
  });
});
