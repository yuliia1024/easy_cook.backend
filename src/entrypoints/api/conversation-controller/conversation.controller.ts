import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConversationControllerService } from './conversation-controller.service';
import {
  CreateConversationDto,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/conversation.dto';
import {
  ConversationResponseDto,
  ConversationSummaryResponseDto,
} from './dto/conversation.response.dto';

/** Conversations with the assistant (a deterministic stub until the LLM stage). */
@ApiTags('Conversations')
@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversationControllerService: ConversationControllerService) {}

  /** Most recently active first. */
  @Get()
  async getAll(): Promise<ConversationSummaryResponseDto[]> {
    return this.conversationControllerService.getAll();
  }

  @Get(':id')
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<ConversationResponseDto> {
    return this.conversationControllerService.getById(id);
  }

  /** 404 for an unknown `menuId`. */
  @Post()
  async create(@Body() dto: CreateConversationDto): Promise<ConversationResponseDto> {
    return this.conversationControllerService.create(dto);
  }

  /** `menuId: null` detaches the menu. */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    return this.conversationControllerService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.conversationControllerService.delete(id);
  }

  /**
   * Saves the message and the assistant reply and returns the conversation. When the assistant
   * plans a menu, the reply links the new version (`menuVersionId`) and the conversation the menu.
   * Limited to 30 messages a minute: each one may plan a menu.
   */
  @Post(':id/messages')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ): Promise<ConversationResponseDto> {
    return this.conversationControllerService.sendMessage(id, dto);
  }
}
