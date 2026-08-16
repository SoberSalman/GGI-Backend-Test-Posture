import { ConfigService } from '@nestjs/config';
import { ChargeRequest } from '../../application/payment-gateway.port';
import { SimulatedPaymentGateway } from './simulated-payment.gateway';

const REQUEST: ChargeRequest = {
  userId: 'user-1',
  subscriptionId: 'sub-1',
  amountCents: 2999,
  description: 'PRO bundle renewal (MONTHLY)',
};

function gatewayWith(failureRate: number): SimulatedPaymentGateway {
  return new SimulatedPaymentGateway({
    get: () => failureRate,
  } as unknown as ConfigService);
}

describe('SimulatedPaymentGateway', () => {
  afterEach(() => jest.restoreAllMocks());

  it('always succeeds when the failure rate is zero', async () => {
    const result = await gatewayWith(0).charge(REQUEST);

    expect(result.outcome).toBe('SUCCEEDED');
    expect(result).toHaveProperty('reference', expect.stringMatching(/^sim_/));
  });

  it('always fails when the failure rate is one, with a reason', async () => {
    const result = await gatewayWith(1).charge(REQUEST);

    expect(result.outcome).toBe('FAILED');
    if (result.outcome === 'FAILED') {
      expect(result.reason).toMatch(
        /insufficient_funds|card_expired|issuer_declined|payment_method_removed/,
      );
    }
  });

  it('declines when the draw falls below the configured rate', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.1);

    await expect(gatewayWith(0.2).charge(REQUEST)).resolves.toMatchObject({ outcome: 'FAILED' });
  });

  it('approves when the draw sits above the configured rate', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9);

    await expect(gatewayWith(0.2).charge(REQUEST)).resolves.toMatchObject({
      outcome: 'SUCCEEDED',
    });
  });
});
