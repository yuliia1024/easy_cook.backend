import { Injectable } from '@nestjs/common';
import { ChatService } from '../../../modules/services/chat/chat.service';
import {
  CreateConversationDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversation.dto';
import {
  ConversationResponseDto,
  ConversationSummaryResponseDto,
} from './dto/conversation.response.dto';

@Injectable()
export class ConversationControllerService {
  constructor(private readonly chatService: ChatService) {}

  public async getAll(): Promise<ConversationSummaryResponseDto[]> {
    const conversations = await this.chatService.getAll();
    return conversations.map(ConversationSummaryResponseDto.from);
  }

  public async getById(id: string): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.chatService.getById(id));
  }

  public async create(dto: CreateConversationDto): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.chatService.create(dto));
  }

  public async update(id: string, dto: UpdateConversationDto): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.chatService.update(id, dto));
  }

  public async delete(id: string): Promise<void> {
    await this.chatService.delete(id);
  }

  public async sendMessage(
    id: string,
    { content }: SendMessageDto,
  ): Promise<ConversationResponseDto> {
    return ConversationResponseDto.from(await this.chatService.sendMessage(id, content));
  }
}
