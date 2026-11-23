import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { SessionRequiredUnauthorizedException } from '../../../common/exceptions';
import { buildUser } from '../../../test/fixtures';
import { httpContext } from '../../../test/http-context';
import { CurrentSession } from './current-session.decorator';

function factoryOf(decorator: ParameterDecorator): (data: unknown, context: unknown) => unknown {
  class Target {
    handler(_session: unknown): void {}
  }
  decorator(Target.prototype, 'handler', 0);
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Target, 'handler');
  return (Object.values(args)[0] as { factory: (d: unknown, c: unknown) => unknown }).factory;
}

describe('CurrentSession', () => {
  const factory = factoryOf(CurrentSession());

  it('gives the session the guard checked', () => {
    const session = { user: buildUser(), tokenHash: 'hash' };

    expect(factory(undefined, httpContext({ authSession: session }))).toBe(session);
  });

  it('is 401 on a request without one', () => {
    expect(() => factory(undefined, httpContext({}))).toThrow(SessionRequiredUnauthorizedException);
  });
});
