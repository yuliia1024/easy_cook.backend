import { PasswordConfigService } from '../../../configs/password-config/password-config.service';
import { createMock } from '../../../test/create-mock';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  // Real bcrypt with the cheapest cost, so hashing stays fast.
  const service = new PasswordService(createMock<PasswordConfigService>({ saltRounds: 4 }));

  it('hashes with a salt, never storing the plain password', async () => {
    const hash = await service.hash('Secret123');

    expect(hash).not.toContain('Secret123');
    expect(hash).toMatch(/^\$2[aby]\$04\$/);
    expect(await service.hash('Secret123')).not.toBe(hash);
  });

  it('accepts the right password', async () => {
    const hash = await service.hash('Secret123');

    await expect(service.compare('Secret123', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('Secret123');

    await expect(service.compare('Secret124', hash)).resolves.toBe(false);
  });

  it.each([null, undefined, ''])('rejects when there is no hash (%p)', async (hash) => {
    await expect(service.compare('Secret123', hash)).resolves.toBe(false);
  });
});
