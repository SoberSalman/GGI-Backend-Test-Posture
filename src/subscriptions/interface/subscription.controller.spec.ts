import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { CurrentUserGuard } from '../../shared/auth/current-user.guard';
import { User } from '../../users/domain/user.entity';
import { BillingService } from '../application/billing.service';
import { SubscriptionService } from '../application/subscription.service';
import { BillingCycle, BundleTier, SubscriptionStatus } from '../domain/bundle-tier';
import { Payment, PaymentKind, PaymentStatus } from '../domain/payment.entity';
import { Subscription } from '../domain/subscription.entity';
import { BillingController } from './billing.controller';
import { SubscriptionController } from './subscription.controller';

const NOW = new Date('2026-08-16T12:00:00Z');
const USER = Object.assign(new User(), { id: 'user-1', email: 'a@b.c', name: 'A' });

function bundle(overrides: Partial<Subscription> = {}): Subscription {
  return Object.assign(new Subscription(), {
    id: 'sub-1',
    userId: 'user-1',
    tier: BundleTier.PRO,
    billingCycle: BillingCycle.MONTHLY,
    status: SubscriptionStatus.ACTIVE,
    maxMessages: 100,
    messagesUsed: 40,
    priceCents: 2999,
    autoRenew: true,
    startDate: NOW,
    endDate: new Date('2026-09-16T12:00:00Z'),
    renewalDate: new Date('2026-09-16T12:00:00Z'),
    cancelledAt: null,
    renewalCount: 0,
    lastPaymentFailureReason: null,
    createdAt: NOW,
    ...overrides,
  } satisfies Partial<Subscription>);
}

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let billingController: BillingController;
  let subscriptions: jest.Mocked<SubscriptionService>;
  let billing: jest.Mocked<BillingService>;

  beforeEach(async () => {
    subscriptions = {
      create: jest.fn().mockResolvedValue(bundle()),
      listForUser: jest.fn().mockResolvedValue([bundle()]),
      getOwned: jest.fn().mockResolvedValue(bundle()),
      setAutoRenew: jest.fn().mockResolvedValue(bundle({ autoRenew: false, renewalDate: null })),
      cancel: jest
        .fn()
        .mockResolvedValue(bundle({ status: SubscriptionStatus.CANCELLED, cancelledAt: NOW })),
      paymentHistory: jest.fn().mockResolvedValue([
        Object.assign(new Payment(), {
          id: 'pay-1',
          subscriptionId: 'sub-1',
          userId: 'user-1',
          kind: PaymentKind.INITIAL,
          status: PaymentStatus.SUCCEEDED,
          amountCents: 2999,
          failureReason: null,
          createdAt: NOW,
        } satisfies Partial<Payment>),
      ]),
    } as unknown as jest.Mocked<SubscriptionService>;

    billing = {
      runBillingCycle: jest.fn().mockResolvedValue({
        runAt: NOW,
        processed: 2,
        renewed: 1,
        failed: 1,
        expired: 0,
        outcomes: [
          {
            subscriptionId: 'sub-1',
            userId: 'user-1',
            tier: 'PRO',
            result: 'RENEWED',
            nextEndDate: new Date('2026-10-16T12:00:00Z'),
          },
          {
            subscriptionId: 'sub-2',
            userId: 'user-2',
            tier: 'BASIC',
            result: 'PAYMENT_FAILED',
            reason: 'card_expired',
          },
        ],
      }),
    } as unknown as jest.Mocked<BillingService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [SubscriptionController, BillingController],
      providers: [
        { provide: SubscriptionService, useValue: subscriptions },
        { provide: BillingService, useValue: billing },
        { provide: ConfigService, useValue: { get: () => '' } },
      ],
    })
      .overrideGuard(CurrentUserGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = moduleRef.get(SubscriptionController);
    billingController = moduleRef.get(BillingController);
  });

  it('publishes the tier catalogue with prices for both cycles', () => {
    const catalog = controller.catalog();

    expect(catalog).toEqual([
      {
        tier: 'BASIC',
        maxMessages: 10,
        unlimited: false,
        pricing: { MONTHLY: '9.99', YEARLY: '99.90' },
      },
      {
        tier: 'PRO',
        maxMessages: 100,
        unlimited: false,
        pricing: { MONTHLY: '29.99', YEARLY: '299.90' },
      },
      {
        tier: 'ENTERPRISE',
        maxMessages: null,
        unlimited: true,
        pricing: { MONTHLY: '99.99', YEARLY: '999.90' },
      },
    ]);
  });

  it('defaults auto-renew to on when the field is omitted', async () => {
    await controller.create(USER, { tier: BundleTier.PRO, billingCycle: BillingCycle.MONTHLY });

    expect(subscriptions.create).toHaveBeenCalledWith({
      userId: 'user-1',
      tier: BundleTier.PRO,
      billingCycle: BillingCycle.MONTHLY,
      autoRenew: true,
    });
  });

  it('honours an explicit auto-renew of false', async () => {
    await controller.create(USER, {
      tier: BundleTier.BASIC,
      billingCycle: BillingCycle.YEARLY,
      autoRenew: false,
    });

    expect(subscriptions.create).toHaveBeenCalledWith(
      expect.objectContaining({ autoRenew: false }),
    );
  });

  it('lists the caller’s bundles as views, not entities', async () => {
    const list = await controller.list(USER);

    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'sub-1', price: '29.99', remainingMessages: 60 });
  });

  it('scopes a single-bundle read to the caller', async () => {
    await controller.findOne(USER, 'sub-1');
    expect(subscriptions.getOwned).toHaveBeenCalledWith('sub-1', 'user-1');
  });

  it('returns billing history', async () => {
    const payments = await controller.payments(USER, 'sub-1');
    expect(payments[0]).toMatchObject({ kind: 'INITIAL', status: 'SUCCEEDED', amount: '29.99' });
  });

  it('turns auto-renew off', async () => {
    const result = await controller.setAutoRenew(USER, 'sub-1', { autoRenew: false });

    expect(subscriptions.setAutoRenew).toHaveBeenCalledWith('sub-1', 'user-1', false);
    expect(result).toMatchObject({ autoRenew: false, renewalDate: null });
  });

  it('cancels a bundle', async () => {
    const result = await controller.cancel(USER, 'sub-1');

    expect(subscriptions.cancel).toHaveBeenCalledWith('sub-1', 'user-1');
    expect(result.status).toBe('CANCELLED');
  });

  describe('POST /billing/run', () => {
    it('serialises every date in the report', async () => {
      const report = await billingController.run();

      expect(report).toMatchObject({
        runAt: '2026-08-16T12:00:00.000Z',
        processed: 2,
        renewed: 1,
        failed: 1,
      });
      expect(report.outcomes[0].nextEndDate).toBe('2026-10-16T12:00:00.000Z');
      expect(report.outcomes[1].nextEndDate).toBeNull();
    });
  });
});
