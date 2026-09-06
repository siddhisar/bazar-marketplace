/**
 * Turns whatever a request claims an offer/counter price is into a trustworthy
 * number, or rejects it — the backend half of "do not rely only on frontend
 * validation."
 */

/** NUMERIC(10, 2)'s own ceiling — anything above this cannot be stored. */
export const MAX_OFFER_PRICE = 99_999_999.99;

/**
 * A valid offer amount: a finite number, greater than ₹0, rounded to paise
 * and within what the `offered_price`/`counter_price` columns can hold.
 *
 * @returns the rounded amount, or null for anything that is not a usable price
 *          — empty, non-numeric text, zero, negative, `NaN`/`Infinity`, or too large.
 */
export function parseOfferPrice(value: unknown): number | null {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(raw)) return null;

  const rounded = Math.round(raw * 100) / 100;
  if (rounded <= 0 || rounded > MAX_OFFER_PRICE) return null;

  return rounded;
}

/** A listing id from a path/body is a bigint; validate it is all digits. */
export const isValidListingId = (value: unknown): value is string =>
  typeof value === "string" && /^\d+$/.test(value);
