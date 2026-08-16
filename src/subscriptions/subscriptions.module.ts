import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionQuotaPort } from '../shared/contracts/subscription-quota.port';
import { UsersModule } from '../users/users.module';
import { BillingService } from './application/billing.service';
import { PaymentGateway } from './application/payment-gateway.port';
import { SubscriptionQuotaService } from './application/subscription-quota.service';
import { SubscriptionService } from './application/subscription.service';
import { Payment } from './domain/payment.entity';
import { Subscription } from './domain/subscription.entity';
import { BillingScheduler } from './infrastructure/billing.scheduler';
import { PaymentRepository } from './infrastructure/payment.repository';
import { SimulatedPaymentGateway } from './infrastructure/payment/simulated-payment.gateway';
import { SubscriptionRepository } from './infrastructure/subscription.repository';
import { BillingController } from './interface/billing.controller';
import { SubscriptionController } from './interface/subscription.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Subscription, Payment]), UsersModule],
  controllers: [SubscriptionController, BillingController],
  providers: [
    SubscriptionRepository,
    PaymentRepository,
    SubscriptionService,
    BillingService,
    BillingScheduler,
    SubscriptionQuotaService,
    // Outbound port -> simulated adapter. Swap this one line for a real PSP.
    { provide: PaymentGateway, useClass: SimulatedPaymentGateway },
    // Inbound contract consumed by the chat module.
    { provide: SubscriptionQuotaPort, useExisting: SubscriptionQuotaService },
  ],
  exports: [SubscriptionQuotaPort, SubscriptionService, BillingService],
})
export class SubscriptionsModule {}
