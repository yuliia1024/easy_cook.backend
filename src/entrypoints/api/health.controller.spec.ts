import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports ok', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });

  it('is not rate limited', () => {
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', HealthController)).toBe(true);
  });
});
