import { ActivityLevel, Goal, Sex } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { ProfileControllerService } from './profile-controller.service';
import { ProfileController } from './profile.controller';

describe('ProfileController', () => {
  let service: jest.Mocked<ProfileControllerService>;
  let controller: ProfileController;

  beforeEach(() => {
    service = createMock<ProfileControllerService>();
    controller = new ProfileController(service);
  });

  it('get', async () => {
    service.get.mockResolvedValue('profile' as never);

    await expect(controller.get()).resolves.toBe('profile');
  });

  it('getOptions', () => {
    service.getOptions.mockReturnValue('options' as never);

    expect(controller.getOptions()).toBe('options');
  });

  it('save / update', async () => {
    const dto = {
      age: 30,
      heightCm: 170,
      weightKg: 65,
      sex: Sex.Male,
      activityLevel: ActivityLevel.Light,
      goal: Goal.GainMuscle,
    };

    await controller.save(dto);
    await controller.update({ age: 31 });

    expect(service.save).toHaveBeenCalledWith(dto);
    expect(service.update).toHaveBeenCalledWith({ age: 31 });
  });
});
