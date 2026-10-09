import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser } from './current-user';

/** Extracts the factory Nest calls to resolve a custom param decorator. */
function getFactory(): (data: unknown, ctx: ExecutionContext) => unknown {
  class TestController {
    handler(@CurrentUser() _user: unknown): void {}
  }
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'handler');
  return args[Object.keys(args)[0]].factory;
}

describe('CurrentUser', () => {
  const user = { userId: 'u1', sessionId: 's1' };
  const ctx = (req: object): ExecutionContext =>
    ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;
  const factory = getFactory();

  it('returns the whole authenticated user', () => {
    expect(factory(undefined, ctx({ user }))).toEqual(user);
  });

  it('returns a single field', () => {
    expect(factory('userId', ctx({ user }))).toBe('u1');
    expect(factory('sessionId', ctx({ user }))).toBe('s1');
  });

  it('returns undefined when the route is not guarded', () => {
    expect(factory('userId', ctx({}))).toBeUndefined();
  });
});
