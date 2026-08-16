import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { UsersModule } from '../users/users.module';
import { AiProvider } from './application/ai-provider.port';
import { ChatService } from './application/chat.service';
import { QuotaService } from './application/quota.service';
import { ChatMessage } from './domain/chat-message.entity';
import { FreeQuota } from './domain/free-quota.entity';
import { MockOpenAiProvider } from './infrastructure/ai/mock-openai.provider';
import { ChatMessageRepository } from './infrastructure/chat-message.repository';
import { FreeQuotaRepository } from './infrastructure/free-quota.repository';
import { FreeQuotaScheduler } from './infrastructure/free-quota.scheduler';
import { ChatController } from './interface/chat.controller';
import { FreeQuotaController } from './interface/free-quota.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatMessage, FreeQuota]),
    UsersModule,
    // Provides SubscriptionQuotaPort, chat never touches subscription tables.
    SubscriptionsModule,
  ],
  controllers: [ChatController, FreeQuotaController],
  providers: [
    ChatMessageRepository,
    FreeQuotaRepository,
    QuotaService,
    ChatService,
    FreeQuotaScheduler,
    // Outbound port -> mocked adapter. Swap this line for a real OpenAI client.
    { provide: AiProvider, useClass: MockOpenAiProvider },
  ],
  exports: [ChatService, QuotaService],
})
export class ChatModule {}
