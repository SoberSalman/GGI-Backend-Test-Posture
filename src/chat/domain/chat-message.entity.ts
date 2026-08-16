import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/domain/user.entity';

export enum QuotaSource {
  FREE_TIER = 'FREE_TIER',
  SUBSCRIPTION = 'SUBSCRIPTION',
}

/**
 * One question/answer exchange plus its token accounting.
 *
 * Append-only: this is the usage history that must survive a cancellation, so
 * rows are never updated or deleted.
 */
@Entity({ name: 'chat_messages' })
@Index(['userId', 'createdAt'])
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'text' })
  question!: string;

  @Column({ type: 'text' })
  answer!: string;

  @Column({ type: 'varchar', length: 100 })
  model!: string;

  @Column({ type: 'int' })
  promptTokens!: number;

  @Column({ type: 'int' })
  completionTokens!: number;

  @Column({ type: 'int' })
  totalTokens!: number;

  @Column({ type: 'enum', enum: QuotaSource, enumName: 'quota_source_enum' })
  quotaSource!: QuotaSource;

  /** Bundle the response was deducted from; `null` for free-tier responses. */
  @Column({ type: 'uuid', nullable: true })
  subscriptionId!: string | null;

  @Column({ type: 'int' })
  latencyMs!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
