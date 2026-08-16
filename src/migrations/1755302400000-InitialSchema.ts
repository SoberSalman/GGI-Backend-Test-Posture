import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema: users, subscriptions, payments, chat messages, free quotas.
 */
export class InitialSchema1755302400000 implements MigrationInterface {
  name = 'InitialSchema1755302400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TYPE "bundle_tier_enum" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE')
    `);
    await queryRunner.query(`
      CREATE TYPE "billing_cycle_enum" AS ENUM ('MONTHLY', 'YEARLY')
    `);
    await queryRunner.query(`
      CREATE TYPE "subscription_status_enum" AS ENUM ('ACTIVE', 'INACTIVE', 'CANCELLED', 'EXPIRED')
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_kind_enum" AS ENUM ('INITIAL', 'RENEWAL')
    `);
    await queryRunner.query(`
      CREATE TYPE "payment_status_enum" AS ENUM ('SUCCEEDED', 'FAILED')
    `);
    await queryRunner.query(`
      CREATE TYPE "quota_source_enum" AS ENUM ('FREE_TIER', 'SUBSCRIPTION')
    `);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(255) NOT NULL,
        "name" character varying(120) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "tier" "bundle_tier_enum" NOT NULL,
        "billingCycle" "billing_cycle_enum" NOT NULL,
        "status" "subscription_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "maxMessages" integer,
        "messagesUsed" integer NOT NULL DEFAULT 0,
        "priceCents" integer NOT NULL,
        "autoRenew" boolean NOT NULL DEFAULT true,
        "startDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "endDate" TIMESTAMP WITH TIME ZONE NOT NULL,
        "renewalDate" TIMESTAMP WITH TIME ZONE,
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "renewalCount" integer NOT NULL DEFAULT 0,
        "lastPaymentFailureReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_subscriptions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_subscriptions_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_subscriptions_messages_used" CHECK ("messagesUsed" >= 0),
        CONSTRAINT "CHK_subscriptions_quota" CHECK ("maxMessages" IS NULL OR "maxMessages" > 0),
        CONSTRAINT "CHK_subscriptions_period" CHECK ("endDate" > "startDate")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_user" ON "subscriptions" ("userId")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_user_status" ON "subscriptions" ("userId", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_subscriptions_renewal" ON "subscriptions" ("renewalDate")
      WHERE "renewalDate" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "subscriptionId" uuid NOT NULL,
        "userId" uuid NOT NULL,
        "kind" "payment_kind_enum" NOT NULL,
        "status" "payment_status_enum" NOT NULL,
        "amountCents" integer NOT NULL,
        "failureReason" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payments_subscription" FOREIGN KEY ("subscriptionId")
          REFERENCES "subscriptions"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_payments_subscription" ON "payments" ("subscriptionId")
    `);
    await queryRunner.query(`CREATE INDEX "IDX_payments_user" ON "payments" ("userId")`);

    await queryRunner.query(`
      CREATE TABLE "chat_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "question" text NOT NULL,
        "answer" text NOT NULL,
        "model" character varying(100) NOT NULL,
        "promptTokens" integer NOT NULL,
        "completionTokens" integer NOT NULL,
        "totalTokens" integer NOT NULL,
        "quotaSource" "quota_source_enum" NOT NULL,
        "subscriptionId" uuid,
        "latencyMs" integer NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chat_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chat_messages_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_chat_messages_user" ON "chat_messages" ("userId")`);
    await queryRunner.query(`
      CREATE INDEX "IDX_chat_messages_user_created" ON "chat_messages" ("userId", "createdAt")
    `);

    await queryRunner.query(`
      CREATE TABLE "free_quotas" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "userId" uuid NOT NULL,
        "periodKey" character varying(7) NOT NULL,
        "messagesUsed" integer NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_free_quotas" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_free_quotas_user" UNIQUE ("userId"),
        CONSTRAINT "FK_free_quotas_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_free_quotas_used" CHECK ("messagesUsed" >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_free_quotas_user" ON "free_quotas" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "free_quotas"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chat_messages"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "subscriptions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "quota_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payment_kind_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "subscription_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "billing_cycle_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "bundle_tier_enum"`);
  }
}
