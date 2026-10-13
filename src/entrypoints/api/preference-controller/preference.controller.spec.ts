import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { PreferenceType } from '../../../common/constants';
import { createMock } from '../../../test/create-mock';
import { PreferenceControllerService } from './preference-controller.service';
import { PreferenceController } from './preference.controller';

describe('PreferenceController', () => {
  let service: jest.Mocked<PreferenceControllerService>;
  let controller: PreferenceController;

  beforeEach(() => {
    service = createMock<PreferenceControllerService>();
    controller = new PreferenceController(service);
  });

  it('getAll / add / remove delegate to the service', async () => {
    const dto = { preferenceType: PreferenceType.Allergy, value: 'peanut' };

    await controller.getAll();
    await controller.add(dto);
    await controller.remove('id-1');

    expect(service.getAll).toHaveBeenCalled();
    expect(service.add).toHaveBeenCalledWith(dto);
    expect(service.remove).toHaveBeenCalledWith('id-1');
  });

  it('answers 204 on delete', () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, PreferenceController.prototype.remove)).toBe(
      HttpStatus.NO_CONTENT,
    );
  });
});
