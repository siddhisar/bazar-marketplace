import { describe, expect, it } from "vitest";
import { MAX_OFFER_PRICE, parseOfferPrice } from "./offer.validator";

describe("parseOfferPrice", () => {
  it("accepts a plain positive number", () => {
    expect(parseOfferPrice(35000)).toBe(35000);
  });

  it("accepts a numeric string, the shape a JSON body's field arrives as", () => {
    expect(parseOfferPrice("35000")).toBe(35000);
  });

  it("rounds to paise rather than storing float noise", () => {
    expect(parseOfferPrice(35000.556)).toBe(35000.56);
  });

  it("rejects zero and negative amounts", () => {
    expect(parseOfferPrice(0)).toBeNull();
    expect(parseOfferPrice(-500)).toBeNull();
  });

  it("rejects an empty or blank offer", () => {
    expect(parseOfferPrice("")).toBeNull();
    expect(parseOfferPrice("   ")).toBeNull();
    expect(parseOfferPrice(undefined)).toBeNull();
    expect(parseOfferPrice(null)).toBeNull();
  });

  it("rejects invalid text, not just missing input", () => {
    expect(parseOfferPrice("not a number")).toBeNull();
    expect(parseOfferPrice("35000; DROP TABLE listing_offers; --")).toBeNull();
  });

  it("rejects NaN and Infinity", () => {
    expect(parseOfferPrice(NaN)).toBeNull();
    expect(parseOfferPrice(Infinity)).toBeNull();
    expect(parseOfferPrice(-Infinity)).toBeNull();
  });

  it("accepts exactly the column's ceiling and rejects one paisa above it", () => {
    expect(parseOfferPrice(MAX_OFFER_PRICE)).toBe(MAX_OFFER_PRICE);
    expect(parseOfferPrice(MAX_OFFER_PRICE + 0.01)).toBeNull();
  });
});
