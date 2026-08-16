import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserService } from '../application/user.service';

/**
 * Read-only helper endpoint. There is no auth module in this assessment, so
 * this is how a reviewer discovers the seeded user ids to put in `x-user-id`.
 */
@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get()
  @ApiOperation({ summary: 'List seeded users (source of x-user-id values)' })
  async list() {
    const users = await this.users.list();
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
    }));
  }
}
