import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from './chat/chat.module';
import { ThrottleConfig, configuration } from './config/configuration';
import { buildDataSourceOptions } from './config/data-source';
import { HealthController } from './health/health.controller';
import { SharedModule } from './shared/shared.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], cache: true }),
    TypeOrmModule.forRoot(buildDataSourceOptions()),
    ScheduleModule.forRoot(),
    // A chat request costs quota and provider time, so the default ceiling is
    // deliberately low; tune per-route if a client needs more.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const throttle = config.getOrThrow<ThrottleConfig>('throttle');
        return [{ ttl: throttle.ttlMs, limit: throttle.limit }];
      },
    }),
    SharedModule,
    UsersModule,
    SubscriptionsModule,
    ChatModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
