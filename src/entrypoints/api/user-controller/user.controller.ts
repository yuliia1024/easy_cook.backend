import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../common/decorators';
import { AuthUser } from '../../../common/types';
import { JwtAuthGuard } from '../../../modules/services/auth/jwt-auth.guard';
import { UserResponseDto } from '../dto/user.response.dto';
import { ChangeEmailDto, ChangePasswordDto, ConfirmEmailChangeDto } from './dto/account.dto';
import { ProfileOptionsResponseDto, SaveProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { UserControllerService } from './user-controller.service';

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(private readonly userControllerService: UserControllerService) {}

  @Get('me')
  async getMe(@CurrentUser('userId') userId: string): Promise<UserResponseDto> {
    return this.userControllerService.getMe(userId);
  }

  /** Values allowed in the questionnaire. */
  @Get('profile/options')
  getProfileOptions(): ProfileOptionsResponseDto {
    return this.userControllerService.getProfileOptions();
  }

  /** Fills in the questionnaire (name, gender, diet), or replaces it completely. */
  @Put('me/profile')
  async saveProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: SaveProfileDto,
  ): Promise<UserResponseDto> {
    return this.userControllerService.saveProfile(userId, dto);
  }

  /** Changes some questionnaire fields. 404 until it was filled in with PUT. */
  @Patch('me/profile')
  async updateProfile(
    @CurrentUser('userId') userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserResponseDto> {
    return this.userControllerService.updateProfile(userId, dto);
  }

  /** Signs out every other session. */
  @Post('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.userControllerService.changePassword(user, dto);
  }

  /** Emails a confirmation code to the new address. */
  @Post('me/email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async requestEmailChange(
    @CurrentUser('userId') userId: string,
    @Body() dto: ChangeEmailDto,
  ): Promise<void> {
    return this.userControllerService.requestEmailChange(userId, dto);
  }

  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  async confirmEmailChange(
    @CurrentUser('userId') userId: string,
    @Body() dto: ConfirmEmailChangeDto,
  ): Promise<UserResponseDto> {
    return this.userControllerService.confirmEmailChange(userId, dto);
  }
}
