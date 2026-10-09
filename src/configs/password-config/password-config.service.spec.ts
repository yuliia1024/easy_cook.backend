import { fakeConfig } from '../../test/fake-config';
import { PasswordConfigService } from './password-config.service';

describe('PasswordConfigService', () => {
  it('exposes the bcrypt salt rounds as a number', () => {
    expect(new PasswordConfigService(fakeConfig({ PASSWORD_HASH_SALT: '12' })).saltRounds).toBe(12);
  });
});
