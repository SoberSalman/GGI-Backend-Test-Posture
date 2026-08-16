import request from 'supertest';
import { App } from 'supertest/types';
import { QuotaSource } from '../src/chat/domain/chat-message.entity';
import { BillingCycle, BundleTier } from '../src/subscriptions/domain/bundle-tier';
import { User } from '../src/users/domain/user.entity';
import { E2EContext, E2E_START, createE2EContext } from './helpers/e2e-app';

const API = '/api/v1';
const FREE_ALLOWANCE = 3;

describe('Chat module (e2e)', () => {
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
  });

  const ask = (user: User, question = 'Why is the sky blue?') =>
    request(server).post(`${API}/chat`).set('x-user-id', user.id).send({ question });

  const buyBundle = (user: User, tier: BundleTier, billingCycle = BillingCycle.MONTHLY) =>
    request(server)
      .post(`${API}/subscriptions`)
      .set('x-user-id', user.id)
      .send({ tier, billingCycle, autoRenew: true });

  describe('authentication', () => {
    it('rejects a request with no x-user-id header', async () => {
      const response = await request(server).post(`${API}/chat`).send({ question: 'hi' });

      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({
        success: false,
        data: null,
        error: { code: 'UNAUTHENTICATED' },
      });
    });

    it('rejects an unknown user id', async () => {
      const response = await request(server)
        .post(`${API}/chat`)
        .set('x-user-id', '00000000-0000-4000-8000-000000000000')
        .send({ question: 'hi' });

      expect(response.status).toBe(401);
    });

    it('rejects a malformed user id without a database error', async () => {
      const response = await request(server)
        .post(`${API}/chat`)
        .set('x-user-id', 'not-a-uuid')
        .send({ question: 'hi' });

      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('request validation', () => {
    let user: User;
    beforeAll(async () => {
      user = await ctx.createUser('Validation');
    });

    it('rejects an empty question', async () => {
      const response = await ask(user, '   ');

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('rejects unknown properties', async () => {
      const response = await request(server)
        .post(`${API}/chat`)
        .set('x-user-id', user.id)
        .send({ question: 'hi', model: 'gpt-5' });

      expect(response.status).toBe(400);
    });
  });

  describe('free monthly allowance', () => {
    let user: User;
    beforeAll(async () => {
      user = await ctx.createUser('FreeTier');
    });

    it('answers, stores tokens, and charges the free tier', async () => {
      const response = await ask(user);

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        model: expect.any(String),
        quotaSource: QuotaSource.FREE_TIER,
        subscriptionId: null,
        quota: { chargedTo: QuotaSource.FREE_TIER, remainingAfter: FREE_ALLOWANCE - 1 },
      });
      expect(response.body.data.usage.totalTokens).toBeGreaterThan(0);
      expect(response.body.data.usage.totalTokens).toBe(
        response.body.data.usage.promptTokens + response.body.data.usage.completionTokens,
      );
    });

    it('simulates provider latency', async () => {
      const response = await ask(user);
      expect(response.body.data.latencyMs).toBeGreaterThan(0);
    });

    it('runs out after exactly three free messages', async () => {
      const third = await ask(user);
      expect(third.status).toBe(201);
      expect(third.body.data.quota.remainingAfter).toBe(0);

      const fourth = await ask(user);
      expect(fourth.status).toBe(402);
      expect(fourth.body.error).toMatchObject({
        code: 'QUOTA_EXCEEDED',
        details: {
          freeMessagesAllowance: FREE_ALLOWANCE,
          freeMessagesUsed: FREE_ALLOWANCE,
          freeMessagesRemaining: 0,
          activeBundles: 0,
          freeQuotaResetsAt: '2026-09-01T00:00:00.000Z',
        },
      });
    });

    it('refills on the 1st of the next month', async () => {
      ctx.clock.setTo(new Date('2026-09-01T00:00:00Z'));

      const response = await ask(user);

      expect(response.status).toBe(201);
      expect(response.body.data.quota.remainingAfter).toBe(FREE_ALLOWANCE - 1);
    });

    it('does not persist a message that was refused', async () => {
      ctx.clock.setTo(E2E_START);
      const history = await request(server)
        .get(`${API}/chat/history`)
        .set('x-user-id', user.id)
        .query({ limit: 100 });

      // 3 in August + 1 in September; the 402 attempt stored nothing.
      expect(history.body.data.pagination.total).toBe(4);
    });
  });

  describe('bundle-backed messages', () => {
    let user: User;
    beforeAll(async () => {
      user = await ctx.createUser('Bundled');
      for (let i = 0; i < FREE_ALLOWANCE; i += 1) await ask(user);
    });

    it('falls through to a bundle once the free allowance is gone', async () => {
      const bundle = await buyBundle(user, BundleTier.BASIC);
      expect(bundle.status).toBe(201);

      const response = await ask(user);

      expect(response.status).toBe(201);
      expect(response.body.data.quota).toMatchObject({
        chargedTo: QuotaSource.SUBSCRIPTION,
        subscriptionId: bundle.body.data.id,
        remainingAfter: 9,
      });
    });

    it('deducts from the bundle with the most remaining quota', async () => {
      const pro = await buyBundle(user, BundleTier.PRO);

      const response = await ask(user);

      // Basic has 9 left, Pro has 100 — Pro wins.
      expect(response.body.data.quota.subscriptionId).toBe(pro.body.data.id);
      expect(response.body.data.quota.remainingAfter).toBe(99);
    });

    it('reports every allowance through the usage endpoint', async () => {
      const usage = await request(server).get(`${API}/chat/usage`).set('x-user-id', user.id);

      expect(usage.body.data.free).toMatchObject({ allowance: 3, used: 3, remaining: 0 });
      expect(usage.body.data.bundles).toHaveLength(2);
      expect(usage.body.data.totalRemaining).toBe(9 + 99);
      expect(usage.body.data.monthToDate.messages).toBe(5);
      expect(usage.body.data.monthToDate.tokens).toBeGreaterThan(0);
    });
  });

  describe('unlimited bundles', () => {
    it('never runs out, and reports null rather than Infinity', async () => {
      const user = await ctx.createUser('Unlimited');
      for (let i = 0; i < FREE_ALLOWANCE; i += 1) await ask(user);
      await buyBundle(user, BundleTier.ENTERPRISE);

      const response = await ask(user);

      expect(response.status).toBe(201);
      expect(response.body.data.quota.remainingAfter).toBeNull();

      const usage = await request(server).get(`${API}/chat/usage`).set('x-user-id', user.id);
      expect(usage.body.data.totalRemaining).toBeNull();
      expect(usage.body.data.bundles[0].remainingMessages).toBeNull();
    });
  });

  describe('history', () => {
    it('paginates newest first and never leaks another user’s messages', async () => {
      const user = await ctx.createUser('History');
      const other = await ctx.createUser('Other');
      await ask(user, 'first');
      await ask(user, 'second');
      await ask(other, 'not yours');

      const page = await request(server)
        .get(`${API}/chat/history`)
        .set('x-user-id', user.id)
        .query({ page: 1, limit: 1 });

      expect(page.body.data.pagination).toEqual({
        total: 2,
        page: 1,
        limit: 1,
        totalPages: 2,
      });
      expect(page.body.data.items[0].question).toBe('second');
    });

    it('rejects an out-of-range page size', async () => {
      const user = await ctx.createUser('BadPaging');
      const response = await request(server)
        .get(`${API}/chat/history`)
        .set('x-user-id', user.id)
        .query({ limit: 5000 });

      expect(response.status).toBe(400);
    });
  });

  describe('free quota reset job', () => {
    it('rolls stale counters into the current month', async () => {
      const user = await ctx.createUser('ResetJob');
      for (let i = 0; i < FREE_ALLOWANCE; i += 1) await ask(user);

      ctx.clock.setTo(new Date('2026-10-05T09:00:00Z'));
      const reset = await request(server)
        .post(`${API}/billing/reset-free-quota`)
        .set('x-user-id', user.id);

      expect(reset.status).toBe(200);
      expect(reset.body.data.rowsReset).toBeGreaterThan(0);

      const usage = await request(server).get(`${API}/chat/usage`).set('x-user-id', user.id);
      expect(usage.body.data.free.remaining).toBe(FREE_ALLOWANCE);
    });
  });
});
