import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MENU_TITLE_MAX_LENGTH } from '../../../../common/constants';
import { Trim } from '../../dto/validators';

export class RenameMenuDto {
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MENU_TITLE_MAX_LENGTH)
  title: string;
}
