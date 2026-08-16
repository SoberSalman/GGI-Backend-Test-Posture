import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ADMIN_KEY_HEADER, AdminAccessDeniedError, AdminGuard } from './admin.guard';

function guardWith(config: { adminApiKey?: string; allowUnauthenticatedAdmin?: boolean }) {
  return new AdminGuard({
    get: (key: string, fallback: unknown) =>
      key in config ? config[key as keyof typeof config] : fallback,
  } as unknown as ConfigService);
}

function contextWith(headers: Record<string, string | string[]>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, method: 'POST', originalUrl: '/api/v1/billing/run' }),
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  describe('with a key configured', () => {
    const guard = guardWith({ adminApiKey: 'correct-horse' });

    it('allows a request presenting the key', () => {
      expect(guard.canActivate(contextWith({ [ADMIN_KEY_HEADER]: 'correct-horse' }))).toBe(true);
    });

    it('refuses a wrong key', () => {
      expect(() => guard.canActivate(contextWith({ [ADMIN_KEY_HEADER]: 'wrong' }))).toThrow(
        AdminAccessDeniedError,
      );
    });

    it('refuses a missing key', () => {
      expect(() => guard.canActivate(contextWith({}))).toThrow(AdminAccessDeniedError);
    });

    it('refuses a prefix of the key, which a length-blind compare would accept', () => {
      expect(() => guard.canActivate(contextWith({ [ADMIN_KEY_HEADER]: 'correct' }))).toThrow(
        AdminAccessDeniedError,
      );
    });

    it('takes the first value when the header is repeated', () => {
      const repeated = contextWith({ [ADMIN_KEY_HEADER]: ['correct-horse', 'wrong'] });
      expect(guard.canActivate(repeated)).toBe(true);
    });
  });

  describe('with no key configured', () => {
    it('refuses by default', () => {
      // The regression this locks: an earlier version allowed the request
      // whenever NODE_ENV was not exactly 'production', so an unset or
      // misspelled value opened billing to anyone.
      expect(() => guardWith({}).canActivate(contextWith({}))).toThrow(AdminAccessDeniedError);
    });

    it('allows only when explicitly opted in', () => {
      const guard = guardWith({ allowUnauthenticatedAdmin: true });
      expect(guard.canActivate(contextWith({}))).toBe(true);
    });
  });
});
