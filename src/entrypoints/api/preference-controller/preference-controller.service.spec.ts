import { PreferenceType } from '../../../common/constants';
import { DietaryPreferenceService } from '../../../modules/services/dietary-preference/dietary-preference.service';
import { createMock } from '../../../test/create-mock';
import { buildPreference } from '../../../test/fixtures';
import { PreferenceControllerService } from './preference-controller.service';

describe('PreferenceControllerService', () => {
  let preferenceService: jest.Mocked<DietaryPreferenceService>;
  let service: PreferenceControllerService;

  beforeEach(() => {
    preferenceService = createMock<DietaryPreferenceService>();
    service = new PreferenceControllerService(preferenceService);
  });

  it('lists mapped preferences', async () => {
    preferenceService.getAll.mockResolvedValue([buildPreference()]);

    await expect(service.getAll()).resolves.toEqual([
      expect.objectContaining({ preferenceType: 'allergy', value: 'peanut' }),
    ]);
  });

  it('adds', async () => {
    const dto = { preferenceType: PreferenceType.DislikedFood, value: 'olives' };
    preferenceService.add.mockResolvedValue(buildPreference(dto));

    await expect(service.add(dto)).resolves.toMatchObject(dto);
    expect(preferenceService.add).toHaveBeenCalledWith(dto);
  });

  it('removes', async () => {
    await service.remove('id-1');

    expect(preferenceService.remove).toHaveBeenCalledWith('id-1');
  });
});
