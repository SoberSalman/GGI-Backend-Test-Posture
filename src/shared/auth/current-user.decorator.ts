import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { User } from '../../users/domain/user.entity';
import { AuthenticatedRequest } from './current-user.guard';

/** Injects the `User` resolved by `CurrentUserGuard` into a handler argument. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
