import {
  Column,
  Entity,
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
 * The row carries the month it belongs to (`periodKey`, `YYYY-MM`), and reads
 * treat a stale row as empty. So the allowance is already correct on the 1st
 * even if the reset job never fires: that job is housekeeping, not the source
 * of truth.
 */
@Entity({ name: 'free_quotas' })
export class FreeQuota {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', unique: true })
  userId!: string;

  @OneToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ type: 'varchar', length: 7 })
  periodKey!: string;

  @Column({ type: 'int', default: 0 })
  messagesUsed!: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  isStale(now: Date): boolean {
    return this.periodKey !== monthKey(now);
  }

  /**
   * Usage for the month containing `now`. A counter left over from a previous
   * month reads as zero, that is the monthly reset.
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

  /**
   * Returns a message consumed in `reservedPeriod`.
   *
   * A slow provider call can straddle midnight on the 1st: reserve in August,
   * fail in September, by which time another request has already rolled the
   * counter over. Refunding blindly would credit August's spend against
   * September's allowance, so a refund for a period that has already closed is
   * dropped instead, the counter it belonged to is gone either way.
   */
  release(reservedPeriod: string): boolean {
    if (this.periodKey !== reservedPeriod) return false;

    this.messagesUsed = Math.max(0, this.messagesUsed - 1);
    return true;
  }
}
