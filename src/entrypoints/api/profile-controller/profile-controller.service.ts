import { Injectable } from '@nestjs/common';
import {
  ActivityLevel,
  DietTag,
  FoodState,
  Goal,
  MealType,
  PreferenceType,
  Sex,
} from '../../../common/constants';
import { UserProfileService } from '../../../modules/services/user-profile/user-profile.service';
import { SaveProfileDto, UpdateProfileDto } from './dto/profile.dto';
import { OptionsResponseDto, ProfileResponseDto } from './dto/profile.response.dto';

@Injectable()
export class ProfileControllerService {
  constructor(private readonly userProfileService: UserProfileService) {}

  public async get(): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.userProfileService.getCurrent());
  }

  public async save(dto: SaveProfileDto): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.userProfileService.save(dto));
  }

  public async update(dto: UpdateProfileDto): Promise<ProfileResponseDto> {
    return ProfileResponseDto.from(await this.userProfileService.update(dto));
  }

  public getOptions(): OptionsResponseDto {
    return {
      sexes: Object.values(Sex),
      activityLevels: Object.values(ActivityLevel),
      goals: Object.values(Goal),
      preferenceTypes: Object.values(PreferenceType),
      dietTags: Object.values(DietTag),
      mealTypes: Object.values(MealType),
      foodStates: Object.values(FoodState),
    };
  }
}
