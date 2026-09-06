/**
 * Password hashing. bcrypt only — plain text never reaches the database, and a
 * password is never logged, including on failure paths.
 */
import bcrypt from "bcryptjs";

/**
 * Work factor. 12 is roughly 200-300ms per hash on typical hardware, which is
 * slow enough to make offline cracking expensive and fast enough for a login
 * request. Raising it invalidates nothing: the cost is stored in the hash, so
 * existing hashes keep verifying.
 */
const SALT_ROUNDS = 12;

/** Minimum accepted length. Enforced on the server, not just in the form. */
export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

/**
 * Verifies a password against a stored hash.
 *
 * `hash` is nullable because an account created through Google has no local
 * password. Returning false rather than throwing means "sign in with a password
 * to a Google-only account" fails exactly like a wrong password, so the response
 * cannot be used to discover how an account was created.
 */
export async function verifyPassword(
  plain: string,
  hash: string | null,
): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}
