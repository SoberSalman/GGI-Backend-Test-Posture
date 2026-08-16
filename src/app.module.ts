import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatModule } from './chat/chat.module';
import { configuration } from './config/configuration';
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
    SharedModule,
    UsersModule,
    SubscriptionsModule,
    ChatModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
