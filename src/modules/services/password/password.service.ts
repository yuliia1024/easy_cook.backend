import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PasswordConfigService } from '../../../configs/password-config/password-config.service';

@Injectable()
export class PasswordService {
  constructor(private readonly passwordConfigService: PasswordConfigService) {}

  public async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.passwordConfigService.saltRounds);
  }

  public async compare(password: string, hash: string | null | undefined): Promise<boolean> {
    if (!hash) {
      return false;
    }
    return bcrypt.compare(password, hash);
  }
}
