import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payment, PaymentKind, PaymentStatus } from '../domain/payment.entity';

export interface NewPayment {
  subscriptionId: string;
  userId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amountCents: number;
  failureReason?: string | null;
}

const MAX_PAYMENTS_RETURNED = 100;

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
  ) {}

  /**
   * Takes an optional manager so a renewal can write the payment and advance
   * the subscription in one transaction.
   */
  async record(entry: NewPayment, manager?: EntityManager): Promise<Payment> {
    const repository = manager ? manager.getRepository(Payment) : this.payments;
    return repository.save(
      repository.create({ failureReason: entry.failureReason ?? null, ...entry }),
    );
  }

  async findForSubscription(
    subscriptionId: string,
    limit = MAX_PAYMENTS_RETURNED,
  ): Promise<Payment[]> {
    return this.payments.find({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async findForUser(userId: string, limit = MAX_PAYMENTS_RETURNED): Promise<Payment[]> {
    return this.payments.find({ where: { userId }, order: { createdAt: 'DESC' }, take: limit });
  }
}
