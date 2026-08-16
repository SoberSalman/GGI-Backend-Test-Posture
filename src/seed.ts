import 'reflect-metadata';
import { DataSource, In } from 'typeorm';
import { buildDataSourceOptions } from './config/data-source';
import { FreeQuota } from './chat/domain/free-quota.entity';
import { monthKey } from './shared/time/billing-period';
import { addBillingCycle } from './subscriptions/application/subscription.service';
import {
  BillingCycle,
  BundleTier,
  SubscriptionStatus,
  tierDefinition,
} from './subscriptions/domain/bundle-tier';
import { Payment, PaymentKind, PaymentStatus } from './subscriptions/domain/payment.entity';
import { Subscription } from './subscriptions/domain/subscription.entity';
import { User } from './users/domain/user.entity';

/**
 * Seeds four users covering the states worth demonstrating:
 *
 * - alice, brand new, 3 free messages, no bundles
 * - bob, free quota spent, one Basic bundle with 2 responses left
 * - carol, free quota spent, Basic (1 left) + Pro (60 left) stacked, so the
 *             selection policy has a real choice to make
 * - dave, free quota spent, an Enterprise bundle (unlimited)
 *
 * Idempotent: re-running wipes the seeded rows and rebuilds them.
 */
async function seed(): Promise<void> {
  const dataSource = new DataSource(buildDataSourceOptions());
  await dataSource.initialize();

  const users = dataSource.getRepository(User);
  const subscriptions = dataSource.getRepository(Subscription);
  const payments = dataSource.getRepository(Payment);
  const freeQuotas = dataSource.getRepository(FreeQuota);

  const now = new Date();
  const period = monthKey(now);

  const seedEmails = [
    'alice@example.com',
    'bob@example.com',
    'carol@example.com',
    'dave@example.com',
  ];
  // Cascades to subscriptions, payments, quotas and chat messages.
  await users.delete({ email: In(seedEmails) });

  const [alice, bob, carol, dave] = await users.save([
    { email: seedEmails[0], name: 'Alice (fresh free tier)' },
    { email: seedEmails[1], name: 'Bob (free tier spent, Basic bundle)' },
    { email: seedEmails[2], name: 'Carol (two stacked bundles)' },
    { email: seedEmails[3], name: 'Dave (Enterprise, unlimited)' },
  ]);

  const FREE_ALLOWANCE = Number.parseInt(process.env.FREE_MESSAGES_PER_MONTH ?? '3', 10);

  await freeQuotas.save([
    { userId: alice.id, periodKey: period, messagesUsed: 0 },
    { userId: bob.id, periodKey: period, messagesUsed: FREE_ALLOWANCE },
    { userId: carol.id, periodKey: period, messagesUsed: FREE_ALLOWANCE },
    { userId: dave.id, periodKey: period, messagesUsed: FREE_ALLOWANCE },
  ]);

  const bundles = await subscriptions.save([
    buildBundle(bob.id, BundleTier.BASIC, BillingCycle.MONTHLY, now, { used: 8, autoRenew: true }),
    buildBundle(carol.id, BundleTier.BASIC, BillingCycle.MONTHLY, now, {
      used: 9,
      autoRenew: true,
    }),
    buildBundle(carol.id, BundleTier.PRO, BillingCycle.YEARLY, now, { used: 40, autoRenew: false }),
    buildBundle(dave.id, BundleTier.ENTERPRISE, BillingCycle.MONTHLY, now, {
      used: 12,
      autoRenew: true,
    }),
  ]);

  await payments.save(
    bundles.map((bundle) => ({
      subscriptionId: bundle.id,
      userId: bundle.userId,
      kind: PaymentKind.INITIAL,
      status: PaymentStatus.SUCCEEDED,
      amountCents: bundle.priceCents,
      failureReason: null,
    })),
  );

  console.log('\nSeed complete. Use these ids in the x-user-id header:\n');
  for (const user of [alice, bob, carol, dave]) {
    console.log(`  ${user.id}  ${user.name}`);
  }
  console.log('');

  await dataSource.destroy();
}

function buildBundle(
  userId: string,
  tier: BundleTier,
  billingCycle: BillingCycle,
  now: Date,
  options: { used: number; autoRenew: boolean },
): Partial<Subscription> {
  const definition = tierDefinition(tier);
  const endDate = addBillingCycle(now, billingCycle);

  return {
    userId,
    tier,
    billingCycle,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: definition.maxMessages,
    messagesUsed: options.used,
    priceCents: definition.priceCents[billingCycle],
    autoRenew: options.autoRenew,
    startDate: now,
    endDate,
    renewalDate: options.autoRenew ? endDate : null,
    cancelledAt: null,
    renewalCount: 0,
    lastPaymentFailureReason: null,
  };
}

seed().catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
