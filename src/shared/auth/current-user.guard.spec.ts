import { ExecutionContext } from '@nestjs/common';
import { UserService } from '../../users/application/user.service';
import { User } from '../../users/domain/user.entity';
import { UnauthenticatedError } from '../domain/errors';
import { AuthenticatedRequest, CurrentUserGuard, USER_ID_HEADER } from './current-user.guard';

const USER_ID = '3f2a1b4c-5d6e-4f70-8a91-b2c3d4e5f601';

function contextWith(headers: Record<string, string | string[]>): {
  context: ExecutionContext;
  request: AuthenticatedRequest;
} {
  const request = { headers } as unknown as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('CurrentUserGuard', () => {
  let guard: CurrentUserGuard;
  let users: jest.Mocked<UserService>;
  const user = Object.assign(new User(), { id: USER_ID, email: 'a@b.c', name: 'A' });

  beforeEach(() => {
    users = { find: jest.fn().mockResolvedValue(user) } as unknown as jest.Mocked<UserService>;
    guard = new CurrentUserGuard(users);
  });

  it('attaches the resolved user to the request', async () => {
    const { context, request } = contextWith({ [USER_ID_HEADER]: USER_ID });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('rejects a request without the header', async () => {
    const { context } = contextWith({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthenticatedError);
    expect(users.find).not.toHaveBeenCalled();
  });

  it('rejects an unknown user id', async () => {
    users.find.mockResolvedValue(null);
    const { context } = contextWith({ [USER_ID_HEADER]: USER_ID });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
  });

  it('uses the first value when the header is sent more than once', async () => {
    const { context } = contextWith({ [USER_ID_HEADER]: [USER_ID, 'other'] });

    await guard.canActivate(context);

    expect(users.find).toHaveBeenCalledWith(USER_ID);
  });
});
