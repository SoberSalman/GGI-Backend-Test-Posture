import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ResourceNotFoundError } from '../../shared/domain/errors';
import { User } from '../domain/user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private readonly users: Repository<User>,
  ) {}

  /** Returns the user, or `null` when the id is unknown or not a valid uuid. */
  async find(id: string): Promise<User | null> {
    if (!UUID_PATTERN.test(id)) return null;
    return this.users.findOne({ where: { id } });
  }

  async getOrThrow(id: string): Promise<User> {
    const user = await this.find(id);
    if (!user) throw new ResourceNotFoundError('User', id);
    return user;
  }

  async list(): Promise<User[]> {
    return this.users.find({ order: { createdAt: 'ASC' } });
  }
}

/**
 * Postgres raises `22P02` on a malformed uuid, which would surface as a 500
 * instead of the 401 the caller deserves.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
