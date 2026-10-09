import { fakeConfig } from '../../test/fake-config';
import { OtpConfigService } from './otp-config.service';

describe('OtpConfigService', () => {
  it('exposes the numeric OTP settings', () => {
    const service = new OtpConfigService(
      fakeConfig({
        OTP_LENGTH: '6',
        OTP_TTL_IN_SEC: '600',
        OTP_MAX_ATTEMPTS: '5',
        OTP_RESEND_COOLDOWN_IN_SEC: '60',
      }),
    );

    expect(service.length).toBe(6);
    expect(service.ttlInSec).toBe(600);
    expect(service.maxAttempts).toBe(5);
    expect(service.resendCooldownInSec).toBe(60);
  });
});
