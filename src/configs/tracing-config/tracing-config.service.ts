import { Injectable } from '@nestjs/common';
import { Environments } from '../../common/types';
import { ConfigService } from '../config.service';

export interface LangfuseSettings {
  publicKey: string;
  secretKey: string;
  /** The SDK default (Langfuse Cloud) when unset. */
  baseUrl: string | undefined;
  /** `ENV`: the traces of every environment are told apart in Langfuse. */
  environment: Environments;
}

/** Tracing of the model calls (`TracingService`, `LlmService`). */
@Injectable()
export class TracingConfigService {
  constructor(private readonly configService: ConfigService) {}

  /** Null (tracing off) unless both keys are set. */
  public get langfuse(): LangfuseSettings | null {
    const publicKey = this.configService.get('LANGFUSE_PUBLIC_KEY');
    const secretKey = this.configService.get('LANGFUSE_SECRET_KEY');
    if (!publicKey || !secretKey) {
      return null;
    }
    return {
      publicKey,
      secretKey,
      baseUrl: this.configService.get('LANGFUSE_BASE_URL') || undefined,
      environment: this.configService.get('ENV'),
    };
  }

  public get isEnabled(): boolean {
    return this.langfuse !== null;
  }

  /**
   * Whether a trace keeps the prompts, messages, tool arguments and replies: only with
   * `ENV=local`, like the chat trace; elsewhere a trace has timings, tokens and tool names alone.
   */
  public get recordsContent(): boolean {
    return this.configService.get('ENV') === Environments.LOCAL;
  }
}
