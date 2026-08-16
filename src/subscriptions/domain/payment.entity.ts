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
  /** The charge taken when the bundle was first purchased. */
  INITIAL = 'INITIAL',
  /** A recurring charge attempted by the billing job. */
  RENEWAL = 'RENEWAL',
}

/**
 * Immutable audit record of every simulated charge.
 *
 * Kept for the lifetime of the account — cancelling a bundle must preserve
 * billing and usage history, so nothing here is ever deleted or updated.
 */
@Entity({ name: 'payments' })
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  subscriptionId!: string;

  @ManyToOne(() => Subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'subscriptionId' })
  subscription?: Subscription;

  @Column({ type: 'uuid' })
  @Index()
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
