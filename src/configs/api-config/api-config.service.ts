import { Injectable } from '@nestjs/common';
import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { ConfigService } from '../config.service';
import { Environments } from '../../common/types';

@Injectable()
export class ApiConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get port(): number {
    return this.configService.getNumber('PORT');
  }

  public get env(): Environments {
    return this.configService.get('ENV');
  }

  public get isSwaggerEnabled(): boolean {
    return this.configService.getBoolean('SWAGGER_ENABLED') && this.env !== Environments.PRODUCTION;
  }

  public get frontEndUrl(): string {
    return this.configService.get('FRONT_END_URL');
  }

  public cors(): CorsOptions {
    const origins = this.configService.get('CORS_ORIGINS') || '*';

    return {
      origin: origins === '*' ? true : origins.split(',').map((o) => o.trim()),
      credentials: true,
    };
  }
}
