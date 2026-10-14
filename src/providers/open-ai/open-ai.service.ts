import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);

  constructor() {}
}
