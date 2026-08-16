import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentKind, PaymentStatus } from '../domain/payment.entity';

@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly payments: Repository<Payment>,
  ) {}

  async record(entry: {
    subscriptionId: string;
    userId: string;
    kind: PaymentKind;
    status: PaymentStatus;
    amountCents: number;
    failureReason?: string | null;
  }): Promise<Payment> {
    return this.payments.save(
      this.payments.create({ failureReason: entry.failureReason ?? null, ...entry }),
    );
  }

  async findForSubscription(subscriptionId: string): Promise<Payment[]> {
    return this.payments.find({ where: { subscriptionId }, order: { createdAt: 'DESC' } });
  }

  async findForUser(userId: string): Promise<Payment[]> {
    return this.payments.find({ where: { userId }, order: { createdAt: 'DESC' } });
  }
}
