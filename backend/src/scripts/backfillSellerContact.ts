/**
 * One-time backfill: populates `phone` and `contact_email` for the generated
 * seed sellers already sitting in the database (created before those columns
 * existed, or before this script did). Not part of the regular seed run —
 * seedMarketplace100k.ts generates this data itself for anything seeded from
 * here on; this just catches up the sellers that predate it.
 *
 * Only touches rows matching the generated-seller email pattern
 * (`seller%@bazaar.test`) and only where the field is still unset, so a real
 * account is never touched and running this twice is harmless.
 *
 * Run with: npm run backfill:seller-contact
 */
import { config } from "../config/env";
import { connectDatabase, disconnectDatabase, query } from "../config/database";

/** Same shape as seedMarketplace100k.ts's dummyPhone, kept in sync by hand
 *  since this is a short-lived catch-up script, not shared library code. */
function dummyPhone(i: number): string {
  return `98765 ${String(i % 100_000).padStart(5, "0")}`;
}

async function main(): Promise<void> {
  await connectDatabase(config.databaseUrl);

  const { rows } = await query<{ id: number; email: string }>(
    `SELECT id, email FROM users
      WHERE email LIKE 'seller%@bazaar.test'
        AND (phone IS NULL OR contact_email IS NULL)
      ORDER BY id`,
  );

  console.log(`[backfill] ${rows.length} seed sellers missing contact info`);

  for (const [index, row] of rows.entries()) {
    // The row's position in `seller1@bazaar.test`-sorted order is its
    // original seed index — reusing it keeps every seller's dummy number
    // distinct, the same guarantee the seed script itself makes.
    const match = row.email.match(/^seller(\d+)@bazaar\.test$/);
    const sellerIndex = match ? Number(match[1]) - 1 : index;

    await query(
      `UPDATE users
          SET phone = COALESCE(phone, $2),
              contact_email = COALESCE(contact_email, $3)
        WHERE id = $1`,
      [
        row.id,
        dummyPhone(sellerIndex),
        `seller${String(sellerIndex + 1).padStart(4, "0")}@example.com`,
      ],
    );
  }

  console.log(`[backfill] done`);
  await disconnectDatabase();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
