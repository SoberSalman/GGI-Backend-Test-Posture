import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Subscription } from './subscription.entity';

export enum PaymentStatus {
  SUCCEEDED = 'SUCCEEDED',
  FAILED = 'FAILED',
}

export enum PaymentKind {
  INITIAL = 'INITIAL',
  RENEWAL = 'RENEWAL',
}

/**
 * Append-only record of every simulated charge.
 *
 * Cancelling or expiring a bundle leaves these rows untouched; only deleting
 * the user removes them, via cascade. A system that has to retain billing
 * records past account deletion would need soft-deleted users instead.
 */
@Entity({ name: 'payments' })
@Index(['subscriptionId', 'createdAt'])
@Index(['userId', 'createdAt'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  subscriptionId!: string;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription?: Subscription;

  @Column({ type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: PaymentKind, enumName: 'payment_kind_enum' })
  kind!: PaymentKind;

  @Column({ type: 'enum', enum: PaymentStatus, enumName: 'payment_status_enum' })
  status!: PaymentStatus;

  @Column({ type: 'int' })
  amountCents!: number;

  @Column({ type: 'text', nullable: true })
  failureReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
