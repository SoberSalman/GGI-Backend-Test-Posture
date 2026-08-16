import request from 'supertest';
import { App } from 'supertest/types';
import {
  BillingCycle,
  BundleTier,
  SubscriptionStatus,
} from '../src/subscriptions/domain/bundle-tier';
import { User } from '../src/users/domain/user.entity';
import { E2EContext, E2E_START, createE2EContext } from './helpers/e2e-app';

const API = '/api/v1';

describe('Subscription module (e2e)', () => {
  let ctx: E2EContext;
  let server: App;

  beforeAll(async () => {
    ctx = await createE2EContext();
    server = ctx.app.getHttpServer() as App;
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.clock.setTo(E2E_START);
    ctx.gateway.reset();
  });

  const buy = (user: User, tier: BundleTier, billingCycle: BillingCycle, autoRenew = true) =>
    request(server)
      .post(`${API}/subscriptions`)
      .set('x-user-id', user.id)
      .send({ tier, billingCycle, autoRenew });

  const runBilling = (user: User) =>
    request(server).post(`${API}/billing/run`).set('x-user-id', user.id);

  const askOnce = (user: User) =>
    request(server).post(`${API}/chat`).set('x-user-id', user.id).send({ question: 'ping' });

  /**
   * A billing run processes every due bundle in the database, not just this
   * test's. Assertions therefore look at the outcome for one subscription
   * rather than at the run totals.
   */
  interface RenewalOutcomeView {
    subscriptionId: string;
    result: 'RENEWED' | 'PAYMENT_FAILED';
    reason?: string;
    nextEndDate: string | null;
  }

  const outcomeFor = (report: request.Response, subscriptionId: string) =>
    (report.body.data.outcomes as RenewalOutcomeView[]).find(
      (outcome) => outcome.subscriptionId === subscriptionId,
    );

  describe('catalog', () => {
    it('publishes all three tiers with monthly and yearly pricing', async () => {
      const user = await ctx.createUser('Catalog');
      const response = await request(server)
        .get(`${API}/subscriptions/catalog`)
        .set('x-user-id', user.id);

      expect(response.body.data).toEqual([
        expect.objectContaining({ tier: 'BASIC', maxMessages: 10 }),
        expect.objectContaining({ tier: 'PRO', maxMessages: 100 }),
        expect.objectContaining({ tier: 'ENTERPRISE', maxMessages: null, unlimited: true }),
      ]);
    });
  });

  describe('creating a bundle', () => {
    it('sets quota, price and the full set of dates', async () => {
      const user = await ctx.createUser('Buyer');

      const response = await buy(user, BundleTier.PRO, BillingCycle.MONTHLY);

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        tier: 'PRO',
        billingCycle: 'MONTHLY',
        status: 'ACTIVE',
        maxMessages: 100,
        messagesUsed: 0,
        remainingMessages: 100,
        price: '29.99',
        autoRenew: true,
        startDate: '2026-08-16T12:00:00.000Z',
        endDate: '2026-09-16T12:00:00.000Z',
        renewalDate: '2026-09-16T12:00:00.000Z',
        cancelledAt: null,
      });
    });

    it('extends a yearly bundle by a full year', async () => {
      const user = await ctx.createUser('YearlyBuyer');

      const response = await buy(user, BundleTier.BASIC, BillingCycle.YEARLY);

      expect(response.body.data.endDate).toBe('2027-08-16T12:00:00.000Z');
      expect(response.body.data.price).toBe('99.90');
    });

    it('leaves the renewal date unset when auto-renew is off', async () => {
      const user = await ctx.createUser('NoRenew');

      const response = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY, false);

      expect(response.body.data.autoRenew).toBe(false);
      expect(response.body.data.renewalDate).toBeNull();
    });

    it('rejects an unknown tier', async () => {
      const user = await ctx.createUser('BadTier');

      const response = await request(server)
        .post(`${API}/subscriptions`)
        .set('x-user-id', user.id)
        .send({ tier: 'PLATINUM', billingCycle: 'MONTHLY' });

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('records the initial charge in billing history', async () => {
      const user = await ctx.createUser('History');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);

      const payments = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}/payments`)
        .set('x-user-id', user.id);

      expect(payments.body.data).toHaveLength(1);
      expect(payments.body.data[0]).toMatchObject({
        kind: 'INITIAL',
        status: 'SUCCEEDED',
        amount: '9.99',
      });
    });
  });

  describe('ownership', () => {
    it('refuses to show another user’s bundle', async () => {
      const owner = await ctx.createUser('Owner');
      const stranger = await ctx.createUser('Stranger');
      const bundle = await buy(owner, BundleTier.BASIC, BillingCycle.MONTHLY);

      const response = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}`)
        .set('x-user-id', stranger.id);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('SUBSCRIPTION_ACCESS_DENIED');
    });

    it('reports an unknown bundle as not found', async () => {
      const user = await ctx.createUser('Missing');

      const response = await request(server)
        .get(`${API}/subscriptions/00000000-0000-4000-8000-000000000000`)
        .set('x-user-id', user.id);

      expect(response.status).toBe(404);
    });
  });

  describe('auto-renew toggle', () => {
    it('clears and re-arms the renewal date', async () => {
      const user = await ctx.createUser('Toggler');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);
      const url = `${API}/subscriptions/${bundle.body.data.id}/auto-renew`;

      const off = await request(server).patch(url).set('x-user-id', user.id).send({
        autoRenew: false,
      });
      expect(off.body.data).toMatchObject({ autoRenew: false, renewalDate: null });

      const on = await request(server).patch(url).set('x-user-id', user.id).send({
        autoRenew: true,
      });
      expect(on.body.data.renewalDate).toBe('2026-09-16T12:00:00.000Z');
    });
  });

  describe('auto-renewal billing', () => {
    it('rolls the period forward and resets the message counter on success', async () => {
      const user = await ctx.createUser('Renewer');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);

      // Spend the free allowance, then two responses from the bundle.
      for (let i = 0; i < 3; i += 1) await askOnce(user);
      await askOnce(user);
      await askOnce(user);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      const report = await runBilling(user);

      expect(outcomeFor(report, bundle.body.data.id)).toMatchObject({
        result: 'RENEWED',
        nextEndDate: '2026-10-16T12:00:00.000Z',
      });

      const after = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}`)
        .set('x-user-id', user.id);

      expect(after.body.data).toMatchObject({
        status: 'ACTIVE',
        messagesUsed: 0,
        remainingMessages: 10,
        renewalCount: 1,
        startDate: '2026-09-16T12:00:00.000Z',
        endDate: '2026-10-16T12:00:00.000Z',
        renewalDate: '2026-10-16T12:00:00.000Z',
      });
    });

    it('marks the bundle inactive when the charge is declined', async () => {
      const user = await ctx.createUser('Declined');
      const bundle = await buy(user, BundleTier.PRO, BillingCycle.MONTHLY);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      ctx.gateway.failFor(bundle.body.data.id, 'card_expired');
      const report = await runBilling(user);

      expect(outcomeFor(report, bundle.body.data.id)).toMatchObject({
        result: 'PAYMENT_FAILED',
        reason: 'card_expired',
      });

      const after = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}`)
        .set('x-user-id', user.id);

      expect(after.body.data).toMatchObject({
        status: SubscriptionStatus.INACTIVE,
        renewalDate: null,
        lastPaymentFailureReason: 'card_expired',
      });
    });

    it('stops serving messages once a bundle goes inactive', async () => {
      const user = await ctx.createUser('DeclinedThenAsk');
      const bundle = await buy(user, BundleTier.PRO, BillingCycle.MONTHLY);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      ctx.gateway.failFor(bundle.body.data.id);
      await runBilling(user);

      // The clock has crossed into September, so the free allowance refilled —
      // spend it before checking that the dead bundle cannot cover the next one.
      for (let i = 0; i < 3; i += 1) {
        expect((await askOnce(user)).status).toBe(201);
      }

      const response = await askOnce(user);

      expect(response.status).toBe(402);
      expect(response.body.error.code).toBe('QUOTA_EXCEEDED');
    });

    it('records the failed charge in billing history', async () => {
      const user = await ctx.createUser('FailedHistory');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      ctx.gateway.failFor(bundle.body.data.id, 'issuer_declined');
      await runBilling(user);

      const payments = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}/payments`)
        .set('x-user-id', user.id);

      expect(payments.body.data[0]).toMatchObject({
        kind: 'RENEWAL',
        status: 'FAILED',
        failureReason: 'issuer_declined',
      });
    });

    it('leaves a bundle with auto-renew off alone', async () => {
      const user = await ctx.createUser('NoAutoRenew');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY, false);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      const report = await runBilling(user);

      expect(outcomeFor(report, bundle.body.data.id)).toBeUndefined();
    });
  });

  describe('cancellation', () => {
    it('stops renewal but keeps serving until the period ends', async () => {
      const user = await ctx.createUser('Canceller');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);
      for (let i = 0; i < 3; i += 1) await askOnce(user);

      const cancelled = await request(server)
        .post(`${API}/subscriptions/${bundle.body.data.id}/cancel`)
        .set('x-user-id', user.id);

      expect(cancelled.body.data).toMatchObject({
        status: 'CANCELLED',
        autoRenew: false,
        renewalDate: null,
        endDate: '2026-09-16T12:00:00.000Z',
      });
      expect(cancelled.body.data.cancelledAt).toBe('2026-08-16T12:00:00.000Z');

      // Still inside the paid period: the bundle must still answer.
      const response = await askOnce(user);
      expect(response.status).toBe(201);
      expect(response.body.data.quota.subscriptionId).toBe(bundle.body.data.id);
    });

    it('preserves usage and billing history after cancellation', async () => {
      const user = await ctx.createUser('CancelHistory');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);
      for (let i = 0; i < 3; i += 1) await askOnce(user);
      await askOnce(user);

      await request(server)
        .post(`${API}/subscriptions/${bundle.body.data.id}/cancel`)
        .set('x-user-id', user.id);

      const after = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}`)
        .set('x-user-id', user.id);
      const payments = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}/payments`)
        .set('x-user-id', user.id);
      const history = await request(server)
        .get(`${API}/chat/history`)
        .set('x-user-id', user.id)
        .query({ limit: 100 });

      expect(after.body.data.messagesUsed).toBe(1);
      expect(payments.body.data).toHaveLength(1);
      expect(history.body.data.pagination.total).toBe(4);
    });

    it('is never renewed by the billing job, and expires when the period closes', async () => {
      const user = await ctx.createUser('CancelExpiry');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);
      await request(server)
        .post(`${API}/subscriptions/${bundle.body.data.id}/cancel`)
        .set('x-user-id', user.id);

      ctx.clock.setTo(new Date('2026-09-16T12:00:01Z'));
      const report = await runBilling(user);

      expect(outcomeFor(report, bundle.body.data.id)).toBeUndefined();
      expect(report.body.data.expired).toBeGreaterThan(0);

      const after = await request(server)
        .get(`${API}/subscriptions/${bundle.body.data.id}`)
        .set('x-user-id', user.id);
      expect(after.body.data.status).toBe('EXPIRED');
    });

    it('refuses to cancel the same bundle twice', async () => {
      const user = await ctx.createUser('DoubleCancel');
      const bundle = await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);
      const url = `${API}/subscriptions/${bundle.body.data.id}/cancel`;

      await request(server).post(url).set('x-user-id', user.id);
      const second = await request(server).post(url).set('x-user-id', user.id);

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('INVALID_SUBSCRIPTION_STATE');
    });
  });

  describe('concurrency', () => {
    it('never lets parallel requests overspend the last response', async () => {
      const user = await ctx.createUser('Racer');
      await buy(user, BundleTier.BASIC, BillingCycle.MONTHLY);

      // 3 free + 10 bundle responses = 13 available; fire 20 at once.
      const responses = await Promise.all(Array.from({ length: 20 }, () => askOnce(user)));

      const served = responses.filter((response) => response.status === 201).length;
      const refused = responses.filter((response) => response.status === 402).length;

      expect(served).toBe(13);
      expect(refused).toBe(7);
    });
  });

  describe('health', () => {
    it('reports a database round-trip', async () => {
      const response = await request(server).get(`${API}/health`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({ status: 'ok', database: { connected: true } });
    });
  });
});
