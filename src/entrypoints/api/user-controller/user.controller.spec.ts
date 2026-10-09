import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Diet, Gender } from '../../../common/constants';
import { JwtAuthGuard } from '../../../modules/services/auth/jwt-auth.guard';
import { createMock } from '../../../test/create-mock';
import { SESSION_ID, USER_ID } from '../../../test/fixtures';
import { UserControllerService } from './user-controller.service';
import { UserController } from './user.controller';

describe('UserController', () => {
  let service: jest.Mocked<UserControllerService>;
  let controller: UserController;

  beforeEach(() => {
    service = createMock<UserControllerService>();
    controller = new UserController(service);
  });

  it('is guarded as a whole', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, UserController)).toContain(JwtAuthGuard);
  });

  it('getMe', async () => {
    service.getMe.mockResolvedValue('me' as never);

    await expect(controller.getMe(USER_ID)).resolves.toBe('me');
    expect(service.getMe).toHaveBeenCalledWith(USER_ID);
  });

  it('getProfileOptions', () => {
    const options = { genders: [Gender.Male], diets: [Diet.Vegan] };
    service.getProfileOptions.mockReturnValue(options);

    expect(controller.getProfileOptions()).toBe(options);
  });

  it('saveProfile / updateProfile', async () => {
    const dto = { firstName: 'Jane', gender: Gender.Female, diet: Diet.Vegan };

    await controller.saveProfile(USER_ID, dto);
    await controller.updateProfile(USER_ID, { diet: Diet.Keto });

    expect(service.saveProfile).toHaveBeenCalledWith(USER_ID, dto);
    expect(service.updateProfile).toHaveBeenCalledWith(USER_ID, { diet: Diet.Keto });
  });

  it('changePassword passes the whole session (to keep it signed in)', async () => {
    const user = { userId: USER_ID, sessionId: SESSION_ID };
    const dto = { currentPassword: 'a', newPassword: 'b' };

    await controller.changePassword(user, dto);

    expect(service.changePassword).toHaveBeenCalledWith(user, dto);
  });

  it('requestEmailChange / confirmEmailChange', async () => {
    await controller.requestEmailChange(USER_ID, { newEmail: 'n@b.c', password: 'p' });
    await controller.confirmEmailChange(USER_ID, { code: '123456' });

    expect(service.requestEmailChange).toHaveBeenCalledWith(USER_ID, {
      newEmail: 'n@b.c',
      password: 'p',
    });
    expect(service.confirmEmailChange).toHaveBeenCalledWith(USER_ID, { code: '123456' });
  });

  it('answers 204 / 200 for the actions', () => {
    const codeOf = (method: keyof UserController): number =>
      Reflect.getMetadata(HTTP_CODE_METADATA, UserController.prototype[method]);

    expect(codeOf('changePassword')).toBe(HttpStatus.NO_CONTENT);
    expect(codeOf('requestEmailChange')).toBe(HttpStatus.NO_CONTENT);
    expect(codeOf('confirmEmailChange')).toBe(HttpStatus.OK);
  });
});
