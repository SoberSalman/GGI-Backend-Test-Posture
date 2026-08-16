import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { BillingCycle, BundleTier } from '../../domain/bundle-tier';

export class CreateSubscriptionDto {
  @ApiProperty({ enum: BundleTier, example: BundleTier.PRO })
  @IsEnum(BundleTier, { message: `tier must be one of: ${Object.values(BundleTier).join(', ')}` })
  tier!: BundleTier;

  @ApiProperty({ enum: BillingCycle, example: BillingCycle.MONTHLY })
  @IsEnum(BillingCycle, {
    message: `billingCycle must be one of: ${Object.values(BillingCycle).join(', ')}`,
  })
  billingCycle!: BillingCycle;

  @ApiPropertyOptional({ default: true, description: 'Charge again at the end of the cycle.' })
  @IsOptional()
  @IsBoolean()
  autoRenew?: boolean;
}
