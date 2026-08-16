import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class UpdateAutoRenewDto {
  @ApiProperty({ example: false })
  @IsBoolean()
  autoRenew!: boolean;
}
