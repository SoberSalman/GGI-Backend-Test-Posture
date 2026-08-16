import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { startOfMonthUtc, startOfNextMonthUtc } from '../../shared/time/billing-period';
import { ChatMessage } from '../domain/chat-message.entity';

export interface MonthToDateUsage {
  messages: number;
  tokens: number;
}

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

  /**
   * Message and token totals for the calendar month containing `now`.
   *
   * Both figures come from one query over one window. Splitting them across two
   * queries let the bounds drift apart, the count was capped at `now` while the
   * token sum ran to the end of time, so the two disagreed about which messages
   * belonged to "this month".
   */
  async monthToDateUsage(userId: string, now: Date): Promise<MonthToDateUsage> {
    const row = await this.messages
      .createQueryBuilder('message')
      .select('COUNT(*)', 'messages')
      .addSelect('COALESCE(SUM(message.totalTokens), 0)', 'tokens')
      .where('message.userId = :userId', { userId })
      .andWhere('message.createdAt >= :from', { from: startOfMonthUtc(now) })
      .andWhere('message.createdAt < :to', { to: startOfNextMonthUtc(now) })
      .getRawOne<{ messages: string; tokens: string }>();

    return {
      messages: Number.parseInt(row?.messages ?? '0', 10),
      tokens: Number.parseInt(row?.tokens ?? '0', 10),
    };
  }
}
