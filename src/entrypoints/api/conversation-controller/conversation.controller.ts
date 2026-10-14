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
  Res,
} from '@nestjs/common';
import { ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
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

/** Conversations with the assistant (OpenAI). */
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
   * Saves the message and streams the assistant reply as text (AI SDK UI message stream); the
   * reply is saved once it is complete. 404 for an unknown conversation comes before the stream.
   * Limited to 30 messages a minute: each one calls the model.
   */
  @Post(':id/messages')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiProduces('text/event-stream')
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const stream = await this.conversationControllerService.sendMessage(id, dto);
    pipeUIMessageStreamToResponse({ response, status: HttpStatus.CREATED, stream });
  }
}
