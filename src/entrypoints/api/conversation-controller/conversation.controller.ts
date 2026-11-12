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
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { pipeUIMessageStreamToResponse } from 'ai';
import { Response } from 'express';
import { ErrorResponseDto } from '../dto/error.response.dto';
import { ConversationControllerService } from './conversation-controller.service';
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

  @Post(':id/preference-change/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm the preference change the assistant proposed',
    description:
      'Applies the change of the dietary preferences the latest assistant reply proposed ' +
      '(`preferenceChange` of the message, the `data-preference-change` stream part), the same as ' +
      'a yes in the chat; the body is that change, as the client shows it. Nothing is written ' +
      'before this or that yes. The removal of an allergy is applied only here, never by a yes in ' +
      'the chat. A change in effect already is not written again: `status` is `already_applied`.',
  })
  @ApiOkResponse({ type: PreferenceChangeResultResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    description:
      'An unknown diet, a diet that conflicts with a saved one, or too many preferences.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    description:
      'Unknown conversation, or its latest reply proposed no change (a later reply ends a proposal).',
  })
  @ApiConflictResponse({
    type: ErrorResponseDto,
    description:
      'The body is not the change waiting for confirmation (e.g. that of a reply that failed), ' +
      'or the preference was saved by a request at the same time.',
  })
  async confirmPreferenceChange(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConfirmPreferenceChangeDto,
  ): Promise<PreferenceChangeResultResponseDto> {
    return this.conversationControllerService.confirmPreferenceChange(id, dto);
  }

  /**
   * Saves the message and streams the assistant reply (AI SDK UI message stream): text parts, plus
   * `data-clarification` when details are missing, `data-menu` for a planned menu,
   * `data-menu-saved` when the chat saved (confirmed) the menu, `data-preference-change` for a
   * change of the preferences waiting for the user's yes, `data-preferences-updated` once one is
   * applied, and `data-error` + `error` when the reply failed. The reply is saved once it is complete. 400 and 404 come before the stream; a client
   * that disconnects stops the model call. Limited to 30 messages a minute: each one calls the model.
   */
  @Post(':id/messages')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiProduces('text/event-stream')
  async sendMessage(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
    @Res() response: Response,
  ): Promise<void> {
    const abort = new AbortController();
    response.on('close', () => {
      if (!response.writableFinished) {
        abort.abort();
      }
    });
    const stream = await this.conversationControllerService.sendMessage(id, dto, abort.signal);
    pipeUIMessageStreamToResponse({ response, status: HttpStatus.CREATED, stream });
  }
}
