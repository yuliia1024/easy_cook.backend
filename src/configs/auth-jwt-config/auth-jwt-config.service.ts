import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';

export interface JwtTokenConfig {
  secret: string;
  expiresInSec: number;
}

@Injectable()
export class AuthJwtConfigService {
  constructor(private readonly configService: ConfigService) {}

  public access(): JwtTokenConfig {
    return {
      secret: this.configService.get('AUTH_JWT_SECRET'),
      expiresInSec: this.configService.getNumber('AUTH_JWT_EXPIRES_IN_SEC'),
    };
  }

  public refresh(): JwtTokenConfig {
    return {
      secret: this.configService.get('AUTH_JWT_REFRESH_SECRET'),
      expiresInSec: this.configService.getNumber('AUTH_JWT_REFRESH_EXPIRES_IN_SEC'),
    };
  }
}
