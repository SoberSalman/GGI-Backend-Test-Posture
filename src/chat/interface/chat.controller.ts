import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { CurrentUserGuard, USER_ID_HEADER } from '../../shared/auth/current-user.guard';
import { Clock } from '../../shared/time/clock';
import { User } from '../../users/domain/user.entity';
import { ChatService } from '../application/chat.service';
import { QuotaSource } from '../domain/chat-message.entity';
import { QuotaService } from '../application/quota.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { toChatMessageView } from './chat.presenter';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

@ApiTags('chat')
@ApiHeader({ name: USER_ID_HEADER, description: 'Id of the calling user', required: true })
@Controller('chat')
@UseGuards(CurrentUserGuard)
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly quota: QuotaService,
    private readonly clock: Clock,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Ask a question and get a (mocked) AI answer' })
  @ApiResponse({
    status: 402,
    description: 'QUOTA_EXCEEDED: no free messages and no usable bundle',
  })
  async ask(@CurrentUser() user: User, @Body() dto: AskQuestionDto) {
    const { message, reservation } = await this.chat.ask({
      userId: user.id,
      question: dto.question,
    });

    return {
      ...toChatMessageView(message),
      quota: {
        chargedTo: reservation.source,
        subscriptionId:
          reservation.source === QuotaSource.SUBSCRIPTION ? reservation.subscriptionId : null,
        remainingAfter: reservation.remainingAfter,
      },
    };
  }

  @Get('history')
  @ApiOperation({ summary: 'Paginated chat history, newest first' })
  async history(@CurrentUser() user: User, @Query() query: HistoryQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = query.limit ?? DEFAULT_LIMIT;
    const result = await this.chat.history(user.id, page, limit);

    return {
      items: result.items.map(toChatMessageView),
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit),
      },
    };
  }

  @Get('usage')
  @ApiOperation({ summary: 'Free-tier and bundle quota, plus this month’s token spend' })
  async usage(@CurrentUser() user: User) {
    const now = this.clock.now();
    const [quota, monthly] = await Promise.all([
      this.quota.summarise(user.id),
      this.chat.monthlyUsage(user.id, now),
    ]);

    return { ...quota, monthToDate: monthly };
  }
}
