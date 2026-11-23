import { Injectable } from '@nestjs/common';
import { UIMessageChunk } from 'ai';
import { ChatOrchestratorService } from '../../../modules/services/chat-orchestrator/chat-orchestrator.service';
import { ConversationService } from '../../../modules/services/conversation/conversation.service';
import { PreferenceChangeService } from '../../../modules/services/preference-change/preference-change.service';
import { toChatStream } from '../chat-stream';
import {
  ConfirmPreferenceChangeDto,
  CreateConversationDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversation.dto';
import {
  ConversationResponseDto,
  ConversationSummaryResponseDto,
  PreferenceChangeResultResponseDto,
} from './dto/conversation.response.dto';

@Injectable()
export class ConversationControllerService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly chatOrchestratorService: ChatOrchestratorService,
    private readonly preferenceChangeService: PreferenceChangeService,
  ) {}

  public async getAll(): Promise<ConversationSummaryResponseDto[]> {
    const conversations = await this.conversationService.getAll();
    return conversations.map(ConversationSummaryResponseDto.from);
  }

  public async getById(id: string): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.conversationService.getById(id));
  }

  public async create(dto: CreateConversationDto): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.conversationService.create(dto));
  }

  public async update(id: string, dto: UpdateConversationDto): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.conversationService.update(id, dto));
  }

  public async delete(id: string): Promise<void> {
    await this.conversationService.delete(id);
  }

  public async confirmPreferenceChange(
    id: string,
    { action, preferenceType, value }: ConfirmPreferenceChangeDto,
  ): Promise<PreferenceChangeResultResponseDto> {
    return PreferenceChangeResultResponseDto.from(
      await this.preferenceChangeService.confirm(id, { action, preferenceType, value }),
    );
  }

  public async sendMessage(
    id: string,
    { content, wishOffer }: SendMessageDto,
    abortSignal?: AbortSignal,
  ): Promise<ReadableStream<UIMessageChunk>> {
    return toChatStream(
      await this.chatOrchestratorService.handleMessage(id, content, abortSignal, wishOffer ?? null),
    );
  }
}
