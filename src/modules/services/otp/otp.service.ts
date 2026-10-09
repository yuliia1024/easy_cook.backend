import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { OtpType, REDIS_KEYS } from '../../../common/constants';
import {
  OtpAttemptsExceededTooManyRequestsException,
  OtpCooldownTooManyRequestsException,
  WrongOtpBadRequestException,
} from '../../../common/exceptions';
import { OtpConfigService } from '../../../configs/otp-config/otp-config.service';
import { REDIS_SERVICE, RedisService } from '../../../providers/redis/redis.service';

/**
 * Numeric one-time codes kept in Redis. Only a SHA-256 of the code is stored, every check
 * spends one of `OTP_MAX_ATTEMPTS` attempts, and a new code of the same type for the same
 * subject cannot be issued more often than `OTP_RESEND_COOLDOWN_IN_SEC`.
 */
@Injectable()
export class OtpService {
  constructor(
    @Inject(REDIS_SERVICE) private readonly redisService: RedisService,
    private readonly otpConfigService: OtpConfigService,
  ) {}

  public get ttlInSec(): number {
    return this.otpConfigService.ttlInSec;
  }

  /**
   * @param subjectId whom the code belongs to (a user id)
   * @param payload extra data returned by `verify` on success (e.g. the new email)
   */
  public async issue(type: OtpType, subjectId: string, payload?: string): Promise<string> {
    const cooldownKey = REDIS_KEYS.otpCooldown(type, subjectId);
    const acquired = await this.redisService.setIfNotExists(
      cooldownKey,
      '1',
      this.otpConfigService.resendCooldownInSec,
    );

    if (!acquired) {
      const retryAfter = await this.redisService.ttl(cooldownKey);
      throw new OtpCooldownTooManyRequestsException(Math.max(retryAfter, 1));
    }

    const code = this.generateCode();

    await this.redisService.hset(
      REDIS_KEYS.otp(type, subjectId),
      { codeHash: this.hashCode(code), attempts: 0, payload: payload ?? '' },
      this.otpConfigService.ttlInSec,
    );

    return code;
  }

  /** Throws unless `code` is the current code. A successful check consumes it. */
  public async verify(type: OtpType, subjectId: string, code: string): Promise<string | null> {
    const key = REDIS_KEYS.otp(type, subjectId);
    const data = await this.redisService.hgetall(key);

    if (!data?.codeHash) {
      throw new WrongOtpBadRequestException();
    }

    // HINCRBY is atomic, so concurrent guesses each spend their own attempt.
    const attempts = await this.redisService.hincrby(key, 'attempts', 1);

    if (attempts > this.otpConfigService.maxAttempts) {
      await this.redisService.delete(key);
      throw new OtpAttemptsExceededTooManyRequestsException();
    }

    if (!this.matches(code, data.codeHash)) {
      throw new WrongOtpBadRequestException();
    }

    // Only the request that actually deletes the key wins, so a code is never used twice.
    const deleted = await this.redisService.delete(key);
    if (deleted === 0) {
      throw new WrongOtpBadRequestException();
    }

    return data.payload || null;
  }

  /** Forgets a code and its cooldown, e.g. when the email carrying it could not be sent. */
  public async revoke(type: OtpType, subjectId: string): Promise<void> {
    await this.redisService.delete([
      REDIS_KEYS.otp(type, subjectId),
      REDIS_KEYS.otpCooldown(type, subjectId),
    ]);
  }

  private generateCode(): string {
    const length = this.otpConfigService.length;
    return randomInt(0, 10 ** length)
      .toString()
      .padStart(length, '0');
  }

  private hashCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private matches(code: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashCode(code), 'hex');
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
