/**
 * Server-side validation for the auth endpoints. The client validates too, but
 * this is the copy that counts — a request can arrive from anywhere.
 *
 * React already stops a user submitting an empty form, so this might look
 * redundant. It isn't: the frontend's checks only stop the *provided* form
 * UI — nothing stops a request going straight to the API with curl, a
 * modified frontend, or a script, skipping the browser entirely. Any rule
 * that must actually hold (password length, a real email shape) has to be
 * enforced again here, on the server, or it does not really exist.
 */
import { MIN_PASSWORD_LENGTH } from "../utils/password";

/** Either the cleaned value or a message to send back verbatim. */
export type Parsed<T> = { value: T } | { error: string };

const MAX_EMAIL_LENGTH = 254; // RFC 5321
const MAX_NAME_LENGTH = 80;
const MAX_PASSWORD_LENGTH = 200; // bcrypt truncates past 72 bytes; reject early

/**
 * Deliberately permissive. Anything stricter rejects addresses that are legal,
 * and the only real proof an address works is sending mail to it.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;

const asString = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function parseRegistration(
  body: unknown,
): Parsed<{ name: string; email: string; password: string }> {
  const input = (body ?? {}) as Record<string, unknown>;

  const name = asString(input.name).trim();
  const email = asString(input.email).trim().toLowerCase();
  const password = asString(input.password);

  if (name.length < 2) return { error: "Please enter your name." };
  if (name.length > MAX_NAME_LENGTH) return { error: "That name is too long." };

  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) {
    return { error: "Please enter a valid email address." };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { error: "That password is too long." };
  }

  return { value: { name, email, password } };
}

/**
 * Login only checks that something usable was sent. Whether it is *correct* is
 * the service's business, and it answers with one message for every failure so
 * this cannot be used to enumerate accounts.
 */
export function parseCredentials(
  body: unknown,
): Parsed<{ email: string; password: string }> {
  const input = (body ?? {}) as Record<string, unknown>;

  const email = asString(input.email).trim().toLowerCase();
  const password = asString(input.password);

  if (!email || !password) {
    return { error: "Please enter your email and password." };
  }
  if (email.length > MAX_EMAIL_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    return { error: "Incorrect email or password." };
  }

  return { value: { email, password } };
}
