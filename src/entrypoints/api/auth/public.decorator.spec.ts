import { IS_PUBLIC_KEY, Public } from './public.decorator';

class Routes {
  @Public()
  health(): void {}

  profile(): void {}
}

describe('Public', () => {
  it('marks a route as callable without a session', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.health)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, Routes.prototype.profile)).toBeUndefined();
  });
});
