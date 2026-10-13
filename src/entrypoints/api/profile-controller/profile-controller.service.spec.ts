import { ActivityLevel, DietTag, FoodState, Goal, Sex } from '../../../common/constants';
import { UserProfileService } from '../../../modules/services/user-profile/user-profile.service';
import { createMock } from '../../../test/create-mock';
import { buildProfile, PROFILE_ID } from '../../../test/fixtures';
import { ProfileControllerService } from './profile-controller.service';

describe('ProfileControllerService', () => {
  let profileService: jest.Mocked<UserProfileService>;
  let service: ProfileControllerService;
  const dto = {
    age: 30,
    heightCm: 170,
    weightKg: 65,
    sex: Sex.Female,
    activityLevel: ActivityLevel.Moderate,
    goal: Goal.Maintain,
  };

  beforeEach(() => {
    profileService = createMock<UserProfileService>();
    profileService.getCurrent.mockResolvedValue(buildProfile());
    profileService.save.mockResolvedValue(buildProfile());
    profileService.update.mockResolvedValue(buildProfile());
    service = new ProfileControllerService(profileService);
  });

  it('get maps the profile', async () => {
    await expect(service.get()).resolves.toMatchObject({ id: PROFILE_ID, weightKg: 65 });
  });

  it('save / update pass the dto through', async () => {
    await service.save(dto);
    await service.update({ weightKg: 60 });

    expect(profileService.save).toHaveBeenCalledWith(dto);
    expect(profileService.update).toHaveBeenCalledWith({ weightKg: 60 });
  });

  it('lists every enum value as options', () => {
    const options = service.getOptions();

    expect(options.sexes).toEqual(Object.values(Sex));
    expect(options.dietTags).toEqual(Object.values(DietTag));
    expect(options.foodStates).toEqual(Object.values(FoodState));
  });
});
