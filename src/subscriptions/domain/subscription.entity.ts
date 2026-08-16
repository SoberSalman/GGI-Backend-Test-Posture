import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/domain/user.entity';
import { BillingCycle, BundleTier, SubscriptionStatus, isUnlimited } from './bundle-tier';

/**
 * A purchased bundle. Users may hold several at once; the chat module picks
 * which one to draw from (see `QuotaSelectionPolicy`).
 *
 * Quota is scoped to the billing period: `messagesUsed` resets to 0 on every
 * successful renewal, never on a calendar boundary.
 */
@Entity({ name: 'subscriptions' })
@Index(['userId', 'status'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  @Index()
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'enum', enum: BundleTier, enumName: 'bundle_tier_enum' })
  tier!: BundleTier;

  @Column({ type: 'enum', enum: BillingCycle, enumName: 'billing_cycle_enum' })
  billingCycle!: BillingCycle;

  @Column({
    type: 'enum',
    enum: SubscriptionStatus,
    enumName: 'subscription_status_enum',
    default: SubscriptionStatus.ACTIVE,
  })
  status!: SubscriptionStatus;

  /** Responses included per billing period. `null` means unlimited. */
  @Column({ type: 'int', nullable: true })
  maxMessages!: number | null;

  /** Responses consumed in the current billing period. */
  @Column({ type: 'int', default: 0 })
  messagesUsed!: number;

  /** Price in minor units (cents) charged each cycle. */
  @Column({ type: 'int' })
  priceCents!: number;

  @Column({ type: 'boolean', default: true })
  autoRenew!: boolean;

  @Column({ type: 'timestamptz' })
  startDate!: Date;

  /** End of the currently paid period. */
  @Column({ type: 'timestamptz' })
  endDate!: Date;

  /**
   * When the next charge is attempted. Equal to `endDate` while auto-renew is
   * on; `null` once renewal has been switched off or the bundle is cancelled.
   */
  @Column({ type: 'timestamptz', nullable: true })
  renewalDate!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  cancelledAt!: Date | null;

  /** Number of successful renewal charges so far. */
  @Column({ type: 'int', default: 0 })
  renewalCount!: number;

  @Column({ type: 'text', nullable: true })
  lastPaymentFailureReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  // ---------------------------------------------------------------------------
  // Domain behaviour
  // ---------------------------------------------------------------------------

  /** Responses left this period. `Infinity` for unlimited tiers. */
  get remainingMessages(): number {
    if (isUnlimited(this.maxMessages)) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.maxMessages - this.messagesUsed);
  }

  get isUnlimited(): boolean {
    return isUnlimited(this.maxMessages);
  }

  /** Inside its paid window at `now`. */
  isWithinPeriod(now: Date): boolean {
    return this.startDate.getTime() <= now.getTime() && now.getTime() < this.endDate.getTime();
  }

  /**
   * Can this bundle serve a message right now? Cancelled bundles still can —
   * cancellation ends renewal, not the period the user already paid for.
   */
  canServe(now: Date): boolean {
    const servingStatus =
      this.status === SubscriptionStatus.ACTIVE || this.status === SubscriptionStatus.CANCELLED;
    return servingStatus && this.isWithinPeriod(now) && this.remainingMessages > 0;
  }

  /** `true` when a renewal charge is due at `now`. */
  isDueForRenewal(now: Date): boolean {
    return (
      this.status === SubscriptionStatus.ACTIVE &&
      this.autoRenew &&
      this.renewalDate !== null &&
      this.renewalDate.getTime() <= now.getTime()
    );
  }
}
