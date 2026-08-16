import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { UserService } from '../../users/application/user.service';
import { User } from '../../users/domain/user.entity';
import { UnauthenticatedError } from '../domain/errors';

export const USER_ID_HEADER = 'x-user-id';

export interface AuthenticatedRequest extends Request {
  user: User;
}

/**
 * Stands in for real authentication: the caller passes `x-user-id` and this
 * resolves it to a `User` row, so nothing downstream ever sees a raw header.
 * Swapping in JWTs means rewriting this file and nothing else.
 */
@Injectable()
export class CurrentUserGuard implements CanActivate {
  constructor(private readonly users: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const headerValue = request.headers[USER_ID_HEADER];
    const userId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!userId) {
      throw new UnauthenticatedError(`Missing '${USER_ID_HEADER}' header.`);
    }

    const user = await this.users.find(userId);
    if (!user) {
      throw new UnauthenticatedError(`Unknown user '${userId}'.`);
    }

    request.user = user;
    return true;
  }
}
