import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Payment } from '../domain/payment.entity';
import { CappedList, MAX_LIST_RESULTS } from './subscription.repository';

export type NewPayment = Omit<Payment, 'id' | 'createdAt' | 'subscription'>;

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
    return repository.save(repository.create(entry));
  }

  async findForSubscription(subscriptionId: string): Promise<CappedList<Payment>> {
    const [items, total] = await this.payments.findAndCount({
      where: { subscriptionId },
      order: { createdAt: 'DESC' },
      take: MAX_LIST_RESULTS,
    });
    return { items, total };
  }
}
