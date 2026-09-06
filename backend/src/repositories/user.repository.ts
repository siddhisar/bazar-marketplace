/**
 * User and OAuth identity data access.
 *
 * Reuses the existing `users` and `oauth_identities` tables rather than adding
 * parallel ones: `users.email` is CITEXT with a UNIQUE constraint, so equality
 * is case-insensitive and duplicate registration is rejected by the database
 * rather than by a check that could race.
 */
import { query } from "../config/database";

export type UserRow = {
  id: number;
  email: string;
  password_hash: string | null;
  display_name: string;
};

/** Every SELECT returns the same shape, so UserRow cannot drift from the query. */
const USER_COLUMNS = "id, email, password_hash, display_name";

/** The same list qualified for the join in findUserByProviderIdentity. */
const USER_COLUMNS_QUALIFIED =
  "u.id, u.email, u.password_hash, u.display_name";

/** Postgres error code for a unique-constraint violation. */
export const UNIQUE_VIOLATION = "23505";

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE email = $1`,
    [email],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Inserts a user. `passwordHash` is null for accounts created through Google.
 *
 * Throws the driver's error on a duplicate email — the caller inspects `code`
 * for UNIQUE_VIOLATION rather than pre-checking, which closes the window where
 * two simultaneous signups could both pass a check and then both insert.
 */
export async function createUser(input: {
  email: string;
  displayName: string;
  passwordHash: string | null;
}): Promise<UserRow> {
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${USER_COLUMNS}`,
    [input.email, input.displayName, input.passwordHash],
  );
  return rows[0];
}

/** The user behind a provider identity, if that identity has been linked. */
export async function findUserByProviderIdentity(
  provider: string,
  providerUserId: string,
): Promise<UserRow | null> {
  const { rows } = await query<UserRow>(
    `SELECT ${USER_COLUMNS_QUALIFIED}
     FROM oauth_identities oi
     JOIN users u ON u.id = oi.user_id
     WHERE oi.provider = $1 AND oi.provider_user_id = $2`,
    [provider, providerUserId],
  );
  return rows[0] ?? null;
}

/**
 * Links a provider identity to a user.
 *
 * ON CONFLICT DO NOTHING makes this idempotent: signing in with Google again
 * re-links the same identity harmlessly instead of erroring on the
 * (provider, provider_user_id) unique constraint.
 */
export async function linkProviderIdentity(input: {
  userId: number;
  provider: string;
  providerUserId: string;
}): Promise<void> {
  await query(
    `INSERT INTO oauth_identities (user_id, provider, provider_user_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_user_id) DO NOTHING`,
    [input.userId, input.provider, input.providerUserId],
  );
}
