import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { MENU_TITLE_MAX_LENGTH, MenuStatus } from '../../../../common/constants';
import { Trim } from '../../dto/validators';

export class RenameMenuDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MENU_TITLE_MAX_LENGTH)
  title: string;
}

export class MenuListQueryDto {
  /** `confirmed` by default: menus the chat generated stay drafts until one is confirmed. */
  @IsOptional()
  @IsEnum(MenuStatus)
  status?: MenuStatus;
}
