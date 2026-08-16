import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Index and constraint corrections found by reviewing the queries the app
 * actually runs against the initial schema.
 */
export class TightenSchemaConstraints1755388800000 implements MigrationInterface {
  name = 'TightenSchemaConstraints1755388800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Single-column indexes fully covered by an existing composite: a btree on
    // (a, b) already serves a lookup on a alone, so these only cost write time.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_messages_user"`);
    // The unique constraint on free_quotas.userId already provides an index.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_free_quotas_user"`);

    // The expiry sweep filters on endDate with no userId predicate, so nothing
    // in the original schema could serve it, it was a full table scan.
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_lapsed" ON "subscriptions" ("endDate")
      WHERE "status" IN ('ACTIVE', 'CANCELLED')
    `);

    // Narrow the renewal index to the rows the billing run actually claims.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_renewal"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_due_renewal" ON "subscriptions" ("renewalDate")
      WHERE "status" = 'ACTIVE' AND "autoRenew" = true
    `);

    // Both payment lookups order by createdAt; make the index do the sorting.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_subscription"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_user"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_subscription_created"
        ON "payments" ("subscriptionId", "createdAt" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_user_created" ON "payments" ("userId", "createdAt" DESC)
    `);

    // payments.userId is denormalised from the subscription; nothing was
    // keeping it pointing at a real user.
    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD CONSTRAINT "FK_payments_user" FOREIGN KEY ("userId")
        REFERENCES "users"("id") ON DELETE CASCADE
    `);

    // "which messages did this bundle pay for" had neither a key nor an index.
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD CONSTRAINT "FK_chat_messages_subscription" FOREIGN KEY ("subscriptionId")
        REFERENCES "subscriptions"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_messages_subscription" ON "chat_messages" ("subscriptionId")
      WHERE "subscriptionId" IS NOT NULL
    `);

    // Money and counters cannot be negative, and a token total that disagrees
    // with its own parts would silently corrupt usage reporting.
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD CONSTRAINT "CHK_subscriptions_price" CHECK ("priceCents" >= 0),
        ADD CONSTRAINT "CHK_subscriptions_renewal_count" CHECK ("renewalCount" >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "payments" ADD CONSTRAINT "CHK_payments_amount" CHECK ("amountCents" >= 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "chat_messages"
        ADD CONSTRAINT "CHK_chat_messages_tokens"
        CHECK (
          "promptTokens" >= 0 AND "completionTokens" >= 0 AND "latencyMs" >= 0
          AND "totalTokens" = "promptTokens" + "completionTokens"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "CHK_chat_messages_tokens"
    `);
    await queryRunner.query(`
      ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "CHK_payments_amount"
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP CONSTRAINT IF EXISTS "CHK_subscriptions_renewal_count",
        DROP CONSTRAINT IF EXISTS "CHK_subscriptions_price"
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chat_messages_subscription"`);
    await queryRunner.query(`
      ALTER TABLE "chat_messages" DROP CONSTRAINT IF EXISTS "FK_chat_messages_subscription"
    `);
    await queryRunner.query(`ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "FK_payments_user"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_user_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_subscription_created"`);
    await queryRunner.query(`CREATE INDEX "IDX_payments_user" ON "payments" ("userId")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_subscription" ON "payments" ("subscriptionId")
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_due_renewal"`);
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_renewal" ON "subscriptions" ("renewalDate")
      WHERE "renewalDate" IS NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_subscriptions_lapsed"`);

    await queryRunner.query(`CREATE INDEX "IDX_free_quotas_user" ON "free_quotas" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_chat_messages_user" ON "chat_messages" ("userId")`);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_user" ON "subscriptions" ("userId")`);
  }
}
