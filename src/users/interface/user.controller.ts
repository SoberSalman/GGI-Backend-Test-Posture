import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserService } from '../application/user.service';

/**
 * Lists the seeded users so a reviewer can find an id for `x-user-id`.
 *
 * Because identity is just that header, this endpoint is the difference between
 * "you need to know a user id" and "here is every user id", i.e. account
 * takeover for anyone who can reach it. It is therefore disabled unless
 * `EXPOSE_SEED_USERS` is on, which defaults to off in production, and it never
 * returns email addresses.
 */
@ApiTags('users')
@Controller('users')
export class UserController {
  private readonly exposeSeedUsers: boolean;

  constructor(
    private readonly users: UserService,
    config: ConfigService,
  ) {
    this.exposeSeedUsers = config.get<boolean>('exposeSeedUsers', false);
  }

  @Get()
  @ApiOperation({ summary: 'List seeded user ids (non-production only)' })
  async list() {
    if (!this.exposeSeedUsers) {
      throw new NotFoundException();
    }

    const users = await this.users.list();
    return users.map((user) => ({ id: user.id, name: user.name }));
  }
}
