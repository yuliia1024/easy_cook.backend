import { Injectable, Logger } from '@nestjs/common';
import {
  ASSISTANT_HISTORY_LIMIT,
  AUTO_TITLE_LENGTH,
  DEFAULT_CONVERSATION_TITLE,
  MessageRole,
} from '../../../common/constants';
import { AppError, ConversationNotFoundException } from '../../../common/exceptions';
import { MenuComposition } from '../../../common/types';
import {
  ConversationRepository,
  ConversationSummary,
  ConversationWithMessages,
} from '../../data-access/conversation/conversation.repository';
import { MenuWithVersions } from '../../data-access/menu/menu.repository';
import { Assistant, AssistantAction } from '../assistant/assistant';
import { MenuService } from '../menu/menu.service';
import { MenuComposer } from '../menu/menu-composer';
import { UserProfileService } from '../user-profile/user-profile.service';

export interface ConversationInput {
  title?: string | null;
  menuId?: string | null;
}

interface ActionResult {
  /** Appended to the assistant reply. */
  summary: string;
  menu: MenuWithVersions | null;
}

/**
 * Conversations with the assistant. A user message is saved first, then the assistant answers
 * from the recent history and the profile; an action it asks for (planning a menu) runs through
 * `MenuService` with the same validation as the API, and its outcome is part of the reply.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly conversationRepository: ConversationRepository,
    private readonly userProfileService: UserProfileService,
    private readonly menuService: MenuService,
    private readonly menuComposer: MenuComposer,
    private readonly assistant: Assistant,
  ) {}

  public async getAll(): Promise<ConversationSummary[]> {
    const profile = await this.userProfileService.getCurrent();
    return this.conversationRepository.findAll(profile.id);
  }

  public async getById(id: string): Promise<ConversationWithMessages> {
    const profile = await this.userProfileService.getCurrent();
    const conversation = await this.conversationRepository.findById(profile.id, id);
    if (!conversation) {
      throw new ConversationNotFoundException();
    }
    return conversation;
  }

  /** 404 for a menu of another profile or an unknown one. */
  public async create(input: ConversationInput): Promise<ConversationWithMessages> {
    const profile = await this.userProfileService.getCurrent();
    if (input.menuId) {
      await this.menuService.getById(input.menuId);
    }
    return this.conversationRepository.create(profile.id, {
      title: input.title ?? DEFAULT_CONVERSATION_TITLE,
      menuId: input.menuId ?? null,
    });
  }

  public async update(id: string, input: ConversationInput): Promise<ConversationWithMessages> {
    await this.getById(id);
    if (input.menuId) {
      await this.menuService.getById(input.menuId);
    }
    return this.conversationRepository.update(id, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.menuId !== undefined && { menuId: input.menuId }),
    });
  }

  public async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.conversationRepository.delete(id);
  }

  /** Saves the message and the assistant reply; returns the whole conversation. */
  public async sendMessage(id: string, content: string): Promise<ConversationWithMessages> {
    const conversation = await this.getById(id);

    await this.conversationRepository.addMessage(id, { role: MessageRole.User, content });
    if (conversation.messages.length === 0 && conversation.title === DEFAULT_CONVERSATION_TITLE) {
      await this.conversationRepository.update(id, { title: this.titleFrom(content) });
    }

    const context = await this.menuComposer.context();
    const history = await this.conversationRepository.findRecentMessages(
      id,
      ASSISTANT_HISTORY_LIMIT,
    );
    const menu = conversation.menuId ? await this.menuService.getById(conversation.menuId) : null;

    const reply = await this.assistant.reply({
      messages: history.map((message) => ({
        role: message.role as MessageRole,
        content: message.content,
      })),
      goal: context.goal,
      rules: context.rules,
      menu: menu && { id: menu.id, title: menu.title },
    });
    const result = reply.action ? await this.run(reply.action) : null;

    await this.conversationRepository.addMessage(id, {
      role: MessageRole.Assistant,
      content: result ? `${reply.content}\n\n${result.summary}` : reply.content,
      menuVersionId: result?.menu?.versions[0]?.id ?? null,
    });
    if (result?.menu) {
      await this.conversationRepository.update(id, { menuId: result.menu.id });
    }

    return this.getById(id);
  }

  /** Runs what the assistant asked for; a rejected action becomes part of the reply. */
  private async run(action: AssistantAction): Promise<ActionResult> {
    try {
      const menu = await this.menuService.generate({
        title: null,
        days: action.days,
        mealTypes: action.mealTypes,
        startDate: null,
        instructions: action.instructions,
      });
      return { summary: this.describeMenu(menu), menu };
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      this.logger.warn(`Assistant action ${action.type} rejected: ${error.message}`);
      return { summary: `I could not plan the menu: ${error.message}`, menu: null };
    }
  }

  private describeMenu(menu: MenuWithVersions): string {
    const composition = menu.versions[0].compositionSnapshot as unknown as MenuComposition;
    const count = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
    const warnings = composition.issues.length;
    return (
      `"${menu.title}" is ready as a draft: ${count(composition.days.length, 'day')}, about ` +
      `${Math.round(composition.dailyAverage.kcal)} kcal a day` +
      (warnings > 0 ? `, ${count(warnings, 'warning')}` : '') +
      '. Open it to review and confirm.'
    );
  }

  private titleFrom(content: string): string {
    const line = content.trim().split('\n')[0];
    return line.length > AUTO_TITLE_LENGTH ? `${line.slice(0, AUTO_TITLE_LENGTH - 1)}…` : line;
  }
}
