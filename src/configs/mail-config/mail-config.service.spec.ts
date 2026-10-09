import { fakeConfig } from '../../test/fake-config';
import { MailConfigService } from './mail-config.service';

describe('MailConfigService', () => {
  it('builds SMTP options with auth when a user is set', () => {
    const service = new MailConfigService(
      fakeConfig({
        SMTP_HOST: 'smtp',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_USER: 'user',
        SMTP_PASSWORD: 'pass',
      }),
    );

    expect(service.smtp()).toEqual({
      host: 'smtp',
      port: 465,
      secure: true,
      auth: { user: 'user', pass: 'pass' },
    });
  });

  it('leaves auth out for an open relay such as Mailpit', () => {
    const options = new MailConfigService(
      fakeConfig({ SMTP_HOST: 'localhost', SMTP_PORT: '1035', SMTP_USER: '' }),
    ).smtp();

    expect(options).toEqual({ host: 'localhost', port: 1035, secure: false });
  });

  it('exposes the sender address', () => {
    expect(new MailConfigService(fakeConfig({ EMAIL_FROM_ADDRESS: 'a@b.c' })).fromAddress).toBe(
      'a@b.c',
    );
  });
});
