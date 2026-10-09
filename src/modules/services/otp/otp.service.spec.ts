import { createHash } from 'crypto';
import { OtpType } from '../../../common/constants';
import {
  OtpAttemptsExceededTooManyRequestsException,
  OtpCooldownTooManyRequestsException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { OtpConfigService } from '../../../configs/otp-config/otp-config.service';
import { RedisService } from '../../../providers/redis/redis.service';
import { createMock } from '../../../test/create-mock';
import { USER_ID } from '../../../test/fixtures';
import { OtpService } from './otp.service';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

describe('OtpService', () => {
  let redis: jest.Mocked<RedisService>;
  let service: OtpService;
  const type = OtpType.EmailVerification;
  const key = `otp:${type}:${USER_ID}`;
  const cooldownKey = `otp:cooldown:${type}:${USER_ID}`;

  beforeEach(() => {
    redis = createMock<RedisService>();
    service = new OtpService(
      redis,
      createMock<OtpConfigService>({
        length: 6,
        ttlInSec: 600,
        maxAttempts: 3,
        resendCooldownInSec: 60,
      }),
    );
  });

  it('exposes the code ttl', () => {
    expect(service.ttlInSec).toBe(600);
  });

  describe('issue', () => {
    beforeEach(() => redis.setIfNotExists.mockResolvedValue(true));

    it('returns a zero padded numeric code of the configured length', async () => {
      const code = await service.issue(type, USER_ID);

      expect(code).toMatch(/^\d{6}$/);
    });

    it('stores only a hash of the code, with attempts and expiry', async () => {
      const code = await service.issue(type, USER_ID, 'payload');

      expect(redis.hset).toHaveBeenCalledWith(
        key,
        { codeHash: sha256(code), attempts: 0, payload: 'payload' },
        600,
      );
      expect(JSON.stringify(redis.hset.mock.calls)).not.toContain(`"${code}"`);
    });

    it('stores an empty payload when none is given', async () => {
      await service.issue(type, USER_ID);

      expect(redis.hset.mock.calls[0][1]).toMatchObject({ payload: '' });
    });

    it('takes the resend cooldown', async () => {
      await service.issue(type, USER_ID);

      expect(redis.setIfNotExists).toHaveBeenCalledWith(cooldownKey, '1', 60);
    });

    it('refuses a new code during the cooldown and says when to retry', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.ttl.mockResolvedValue(42);

      const error = await service.issue(type, USER_ID).catch((e) => e);

      expect(error).toBeInstanceOf(OtpCooldownTooManyRequestsException);
      expect(error.message).toContain('42 seconds');
      expect(redis.hset).not.toHaveBeenCalled();
    });

    it('never reports a retry delay below one second', async () => {
      redis.setIfNotExists.mockResolvedValue(false);
      redis.ttl.mockResolvedValue(-1);

      await expect(service.issue(type, USER_ID)).rejects.toThrow('1 seconds');
    });
  });

  describe('verify', () => {
    const stored = (code: string, payload = ''): Record<string, string> => ({
      codeHash: sha256(code),
      attempts: '0',
      payload,
    });

    it('accepts the right code, consumes it and returns the payload', async () => {
      redis.hgetall.mockResolvedValue(stored('123456', 'new@example.com'));
      redis.hincrby.mockResolvedValue(1);
      redis.delete.mockResolvedValue(1);

      await expect(service.verify(type, USER_ID, '123456')).resolves.toBe('new@example.com');
      expect(redis.hincrby).toHaveBeenCalledWith(key, 'attempts', 1);
      expect(redis.delete).toHaveBeenCalledWith(key);
    });

    it('returns null when the code carries no payload', async () => {
      redis.hgetall.mockResolvedValue(stored('123456'));
      redis.hincrby.mockResolvedValue(1);
      redis.delete.mockResolvedValue(1);

      await expect(service.verify(type, USER_ID, '123456')).resolves.toBeNull();
    });

    it('rejects when there is no code (expired or never issued)', async () => {
      redis.hgetall.mockResolvedValue({});

      await expect(service.verify(type, USER_ID, '123456')).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
      expect(redis.hincrby).not.toHaveBeenCalled();
    });

    it('rejects a wrong code and keeps it for another attempt', async () => {
      redis.hgetall.mockResolvedValue(stored('123456'));
      redis.hincrby.mockResolvedValue(1);

      await expect(service.verify(type, USER_ID, '654321')).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
      expect(redis.delete).not.toHaveBeenCalled();
    });

    it('rejects a code of a different length', async () => {
      redis.hgetall.mockResolvedValue(stored('123456'));
      redis.hincrby.mockResolvedValue(1);

      await expect(service.verify(type, USER_ID, '1234')).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
    });

    it('burns the code once the attempts are used up, even if the guess is right', async () => {
      redis.hgetall.mockResolvedValue(stored('123456'));
      redis.hincrby.mockResolvedValue(4);

      await expect(service.verify(type, USER_ID, '123456')).rejects.toBeInstanceOf(
        OtpAttemptsExceededTooManyRequestsException,
      );
      expect(redis.delete).toHaveBeenCalledWith(key);
    });

    it('lets only one of two concurrent correct requests through', async () => {
      redis.hgetall.mockResolvedValue(stored('123456'));
      redis.hincrby.mockResolvedValue(2);
      redis.delete.mockResolvedValue(0);

      await expect(service.verify(type, USER_ID, '123456')).rejects.toBeInstanceOf(
        WrongOtpBadRequestException,
      );
    });
  });

  it('revoke drops the code and its cooldown', async () => {
    await service.revoke(type, USER_ID);

    expect(redis.delete).toHaveBeenCalledWith([key, cooldownKey]);
  });
});
