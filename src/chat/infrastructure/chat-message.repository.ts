import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { startOfMonthUtc } from '../../shared/time/billing-period';
import { ChatMessage } from '../domain/chat-message.entity';

export interface HistoryPage {
  items: ChatMessage[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class ChatMessageRepository {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly messages: Repository<ChatMessage>,
  ) {}

  async save(message: Partial<ChatMessage>): Promise<ChatMessage> {
    return this.messages.save(this.messages.create(message));
  }

  async findPageForUser(userId: string, page: number, limit: number): Promise<HistoryPage> {
    const [items, total] = await this.messages.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total, page, limit };
  }

  /** Total tokens the user has spent in the calendar month containing `now`. */
  async sumTokensThisMonth(userId: string, now: Date): Promise<number> {
    const { total } = (await this.messages
      .createQueryBuilder('message')
      .select('COALESCE(SUM(message.totalTokens), 0)', 'total')
      .where('message.userId = :userId', { userId })
      .andWhere('message.createdAt >= :from', { from: startOfMonthUtc(now) })
      .getRawOne<{ total: string }>()) ?? { total: '0' };

    return Number.parseInt(total, 10);
  }

  async countInMonth(userId: string, now: Date): Promise<number> {
    return this.messages.count({
      where: { userId, createdAt: Between(startOfMonthUtc(now), now) },
    });
  }
}
