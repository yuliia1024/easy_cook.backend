import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';

@Injectable()
export class PasswordConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get saltRounds(): number {
    return this.configService.getNumber('PASSWORD_HASH_SALT');
  }
}
