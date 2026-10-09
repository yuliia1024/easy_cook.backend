import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';

@Injectable()
export class OtpConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get length(): number {
    return this.configService.getNumber('OTP_LENGTH');
  }

  public get ttlInSec(): number {
    return this.configService.getNumber('OTP_TTL_IN_SEC');
  }

  public get maxAttempts(): number {
    return this.configService.getNumber('OTP_MAX_ATTEMPTS');
  }

  public get resendCooldownInSec(): number {
    return this.configService.getNumber('OTP_RESEND_COOLDOWN_IN_SEC');
  }
}
