import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/auth/current-user.decorator';
import { CurrentUserGuard, USER_ID_HEADER } from '../../shared/auth/current-user.guard';
import { User } from '../../users/domain/user.entity';
import { SubscriptionService } from '../application/subscription.service';
import { TIER_CATALOG } from '../domain/bundle-tier';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateAutoRenewDto } from './dto/update-auto-renew.dto';
import { formatCents, toPaymentView, toSubscriptionView } from './subscription.presenter';

@ApiTags('subscriptions')
@ApiHeader({ name: USER_ID_HEADER, description: 'Id of the calling user', required: true })
@Controller('subscriptions')
@UseGuards(CurrentUserGuard)
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Available bundle tiers, quotas and prices' })
  catalog() {
    return Object.values(TIER_CATALOG).map((definition) => ({
      tier: definition.tier,
      maxMessages: definition.maxMessages,
      unlimited: definition.maxMessages === null,
      pricing: {
        MONTHLY: formatCents(definition.priceCents.MONTHLY),
        YEARLY: formatCents(definition.priceCents.YEARLY),
      },
    }));
  }

  @Post()
  @ApiOperation({ summary: 'Purchase a subscription bundle' })
  async create(@CurrentUser() user: User, @Body() dto: CreateSubscriptionDto) {
    const subscription = await this.subscriptions.create({
      userId: user.id,
      tier: dto.tier,
      billingCycle: dto.billingCycle,
      autoRenew: dto.autoRenew ?? true,
    });
    return toSubscriptionView(subscription);
  }

  @Get()
  @ApiOperation({ summary: "List the caller's bundles, newest first" })
  async list(@CurrentUser() user: User) {
    const subscriptions = await this.subscriptions.listForUser(user.id);
    return subscriptions.map(toSubscriptionView);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single bundle' })
  async findOne(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return toSubscriptionView(await this.subscriptions.getOwned(id, user.id));
  }

  @Get(':id/payments')
  @ApiOperation({ summary: 'Billing history for a bundle (preserved after cancellation)' })
  async payments(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    const payments = await this.subscriptions.paymentHistory(id, user.id);
    return payments.map(toPaymentView);
  }

  @Patch(':id/auto-renew')
  @ApiOperation({ summary: 'Turn auto-renew on or off' })
  async setAutoRenew(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutoRenewDto,
  ) {
    const subscription = await this.subscriptions.setAutoRenew(id, user.id, dto.autoRenew);
    return toSubscriptionView(subscription);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a bundle: stops renewal, keeps serving until the period ends',
  })
  async cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return toSubscriptionView(await this.subscriptions.cancel(id, user.id));
  }
}
