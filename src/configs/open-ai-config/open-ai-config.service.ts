import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config.service';

@Injectable()
export class OpenAiConfigService {
  constructor(private readonly configService: ConfigService) {}

  public get apiKey(): string {
    return this.configService.get('OPEN_AI_API_KEY');
  }
}
