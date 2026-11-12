import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  MESSAGE_MAX_LENGTH,
  PREFERENCE_VALUE_MAX_LENGTH,
  PreferenceChangeAction,
  PreferenceType,
} from '../../../../common/constants';
import { IsOptionalNotNull, Trim } from '../../dto/validators';

export class UpdateConversationDto {
  /** Defaults to the start of the first message. */
  @IsOptionalNotNull()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(CONVERSATION_TITLE_MAX_LENGTH)
  title?: string;

  /** The menu to talk about. */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  menuId?: string | null;
}

export class CreateConversationDto extends UpdateConversationDto {
  /**
   * A conversation to carry the menu details and, unless `menuId` is given, the menu from, such
   * as one that is full (`conversation_limit_reached`). Its messages stay there.
   */
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  fromConversationId?: string | null;
}

export class SendMessageDto {
  /** @example Plan a menu for 3 days */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  content: string;
}

/**
 * The change the client confirms, as the reply proposed it (`data-preference-change`,
 * `preferenceChange` of the message): it must be the one still waiting for confirmation.
 */
export class ConfirmPreferenceChangeDto {
  @IsEnum(PreferenceChangeAction)
  action: PreferenceChangeAction;

  @IsEnum(PreferenceType)
  preferenceType: PreferenceType;

  /** @example peanut */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(PREFERENCE_VALUE_MAX_LENGTH)
  value: string;
}
