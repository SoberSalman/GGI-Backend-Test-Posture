import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  ChargeRequest,
  ChargeResult,
  PaymentGateway,
} from '../../application/payment-gateway.port';

const DECLINE_REASONS = [
  'insufficient_funds',
  'card_expired',
  'issuer_declined',
  'payment_method_removed',
] as const;

/**
 * Simulated PSP. Fails a configurable share of charges (`PAYMENT_FAILURE_RATE`,
 * default 20%) so the auto-renew failure path is exercisable on demand.
 */
@Injectable()
export class SimulatedPaymentGateway extends PaymentGateway {
  private readonly logger = new Logger(SimulatedPaymentGateway.name);
  private readonly failureRate: number;

  constructor(config: ConfigService) {
    super();
    this.failureRate = config.get<number>('paymentFailureRate', 0.2);
  }

  charge(request: ChargeRequest): Promise<ChargeResult> {
    const declined = Math.random() < this.failureRate;

    if (declined) {
      const reason = DECLINE_REASONS[Math.floor(Math.random() * DECLINE_REASONS.length)];
      this.logger.warn(
        `Charge DECLINED (${reason}) for subscription ${request.subscriptionId}: ` +
          `${formatCents(request.amountCents)}`,
      );
      return Promise.resolve({ outcome: 'FAILED', reason });
    }

    this.logger.log(
      `Charge SUCCEEDED for subscription ${request.subscriptionId}: ` +
        `${formatCents(request.amountCents)}`,
    );
    return Promise.resolve({ outcome: 'SUCCEEDED', reference: `sim_${randomUUID()}` });
  }
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
