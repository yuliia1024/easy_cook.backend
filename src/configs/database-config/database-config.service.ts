import { Injectable } from '@nestjs/common';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { ConfigService } from '../config.service';

@Injectable()
export class DatabaseConfigService {
  constructor(private readonly configService: ConfigService) {}

  public config(): TypeOrmModuleOptions {
    return {
      type: 'postgres',
      host: this.configService.get('POSTGRES_HOST'),
      port: this.configService.getNumber('POSTGRES_PORT'),
      username: this.configService.get('POSTGRES_USER'),
      password: this.configService.get('POSTGRES_PASSWORD'),
      database: this.configService.get('POSTGRES_DB'),
      entities: [`${__dirname}/../../modules/**/*.entity{.ts,.js}`],
      migrations: [`${__dirname}/../../database/migrations/*{.ts,.js}`],
      // Schema changes only ever go through migrations, applied on start-up.
      synchronize: false,
      migrationsRun: true,
      logging: this.configService.getBoolean('POSTGRES_LOGGING'),
    };
  }
}
