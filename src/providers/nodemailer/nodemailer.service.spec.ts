import * as Handlebars from 'handlebars';
import * as nodemailer from 'nodemailer';
import { MailConfigService } from '../../configs/mail-config/mail-config.service';
import { createMock } from '../../test/create-mock';
import { NodemailerService } from './nodemailer.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('NodemailerService', () => {
  let sendMail: jest.Mock;
  let service: NodemailerService;
  const smtp = { host: 'localhost', port: 1035 };

  beforeEach(() => {
    sendMail = jest.fn().mockResolvedValue({});
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
    service = new NodemailerService(
      createMock<MailConfigService>({ smtp: () => smtp, fromAddress: 'Easy Cook <no-reply@ec>' }),
    );
  });

  it('creates the SMTP transport from config', () => {
    expect(nodemailer.createTransport).toHaveBeenCalledWith(smtp);
  });

  it('renders the otp-code template and sends it', async () => {
    await service.sendTemplatedEmail('jane@example.com', 'Confirm', 'otp-code', {
      title: 'Welcome',
      message: 'Enter the code',
      code: '123456',
      ttlInMinutes: 10,
    });

    const mail = sendMail.mock.calls[0][0];
    expect(mail).toMatchObject({
      from: 'Easy Cook <no-reply@ec>',
      to: 'jane@example.com',
      subject: 'Confirm',
    });
    expect(mail.html).toContain('123456');
    expect(mail.html).toContain('Welcome');
    expect(mail.html).toContain('10 minutes');
  });

  it('renders the notification template', async () => {
    await service.sendTemplatedEmail('jane@example.com', 'Changed', 'notification', {
      title: 'Password changed',
      message: 'All sessions were signed out.',
    });

    expect(sendMail.mock.calls[0][0].html).toContain('All sessions were signed out.');
  });

  it('escapes user controlled values', async () => {
    await service.sendTemplatedEmail('a@b.c', 's', 'notification', {
      title: '<script>x</script>',
      message: 'm',
    });

    const { html } = sendMail.mock.calls[0][0];
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('compiles each template once', async () => {
    const data = { title: 't', message: 'm' };
    const compile = jest.spyOn(Handlebars, 'compile');

    await service.sendTemplatedEmail('a@b.c', 's', 'notification', data);
    await service.sendTemplatedEmail('a@b.c', 's', 'notification', data);

    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('propagates a transport failure', async () => {
    sendMail.mockRejectedValue(new Error('SMTP down'));

    await expect(
      service.sendTemplatedEmail('a@b.c', 's', 'notification', { title: 't', message: 'm' }),
    ).rejects.toThrow('SMTP down');
  });
});
