import { Controller, Get, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserService } from '../application/user.service';

/**
 * Seeded ids for the `x-user-id` header. Since that header *is* the identity,
 * handing out every id is account takeover, so this stays off unless
 * `EXPOSE_SEED_USERS` is set, and never returns email addresses.
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
