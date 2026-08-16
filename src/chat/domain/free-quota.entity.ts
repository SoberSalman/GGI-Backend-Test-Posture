import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { monthKey } from '../../shared/time/billing-period';
import { User } from '../../users/domain/user.entity';

/**
 * A user's free-message allowance for one calendar month.
 *
 * The row carries the month it belongs to (`periodKey`, `YYYY-MM`). Reads
 * compare that key against the current month and treat a stale row as empty, so
 * the allowance is correct on the 1st even if the cron never fired. The nightly
 * reset job then rewrites stale rows in bulk. Belt and braces on purpose: the
 * scheduled reset is a convenience, not the source of truth.
 */
@Entity({ name: 'free_quotas' })
export class FreeQuota {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  @Index()
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  /** Calendar month this counter belongs to, as `YYYY-MM`. */
  @Column({ type: 'varchar', length: 7 })
  periodKey!: string;

  @Column({ type: 'int', default: 0 })
  messagesUsed!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  /** `true` when this counter belongs to a month that has already ended. */
  isStale(now: Date): boolean {
    return this.periodKey !== monthKey(now);
  }

  /**
   * Usage for the month containing `now`. A counter left over from a previous
   * month reads as zero — that is the monthly reset.
   */
  usedIn(now: Date): number {
    return this.isStale(now) ? 0 : this.messagesUsed;
  }

  remainingIn(now: Date, allowance: number): number {
    return Math.max(0, allowance - this.usedIn(now));
  }

  /** Consumes one free message, rolling the counter into the current month. */
  consume(now: Date): void {
    if (this.isStale(now)) {
      this.periodKey = monthKey(now);
      this.messagesUsed = 0;
    }
    this.messagesUsed += 1;
  }

  /** Returns a consumed message after a downstream failure. */
  release(): void {
    this.messagesUsed = Math.max(0, this.messagesUsed - 1);
  }
}
