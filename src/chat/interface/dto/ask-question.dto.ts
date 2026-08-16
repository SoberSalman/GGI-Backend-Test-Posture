import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

const MAX_QUESTION_LENGTH = 4000;

export class AskQuestionDto {
  @ApiProperty({
    example: 'Explain database connection pooling in one paragraph.',
    maxLength: MAX_QUESTION_LENGTH,
  })
  @IsString()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @Length(1, MAX_QUESTION_LENGTH, {
    message: `question must be between 1 and ${MAX_QUESTION_LENGTH} characters`,
  })
  question!: string;
}
