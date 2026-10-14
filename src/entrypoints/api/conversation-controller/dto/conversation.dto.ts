import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CONVERSATION_TITLE_MAX_LENGTH, MESSAGE_MAX_LENGTH } from '../../../../common/constants';
import { IsOptionalNotNull, Trim } from '../../dto/validators';

export class CreateConversationDto {
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

export class UpdateConversationDto extends CreateConversationDto {}

export class SendMessageDto {
  /** @example Plan a menu for 3 days */
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MESSAGE_MAX_LENGTH)
  content: string;
}
