import { Body, Controller, Get, Patch, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SaveProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { OptionsResponseDto, ProfileResponseDto } from './dto/profile.response.dto';
import { ProfileControllerService } from './profile-controller.service';

/** Single user: there is one profile, so no ids in the paths. */
@ApiTags('Profile')
@Controller('profile')
export class ProfileController {
  constructor(private readonly profileControllerService: ProfileControllerService) {}

  /** 404 until the profile is filled in with PUT. */
  @Get()
  async get(): Promise<ProfileResponseDto> {
    return this.profileControllerService.get();
  }

  /** Allowed values of every enum-like field (profile, preferences, recipes, foods). */
  @Get('options')
  getOptions(): OptionsResponseDto {
    return this.profileControllerService.getOptions();
  }

  /**
   * Creates the profile, or replaces it completely. 400 when weight and height give a BMI outside
   * 12-70, or for `lose_weight` with a BMI below 18.5. `PATCH` checks the same on the result.
   */
  @Put()
  async save(@Body() dto: SaveProfileDto): Promise<ProfileResponseDto> {
    return this.profileControllerService.save(dto);
  }

  @Patch()
  async update(@Body() dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    return this.profileControllerService.update(dto);
  }
}
