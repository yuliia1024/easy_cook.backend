import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EmailDto,
  RefreshTokenDto,
  ResetPasswordDto,
  SignInDto,
  SignUpDto,
  VerifyEmailDto,
} from './auth.dto';

async function errorsOf<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain));
  return errors.map((e) => e.property);
}

describe('auth DTOs', () => {
  describe('SignUpDto', () => {
    it('accepts a valid payload and normalizes the email', async () => {
      const dto = plainToInstance(SignUpDto, {
        email: '  Jane@Example.COM ',
        password: 'Secret123',
      });

      expect(await validate(dto)).toHaveLength(0);
      expect(dto.email).toBe('jane@example.com');
    });

    it.each([
      ['too short', 'Sec1'],
      ['no digit', 'Secretttt'],
      ['no letter', '12345678'],
      ['too long', `a1${'x'.repeat(63)}`],
      ['not a string', 12345678],
    ])('rejects a password that is %s', async (_case, password) => {
      expect(await errorsOf(SignUpDto, { email: 'a@b.cd', password })).toEqual(['password']);
    });

    it.each(['not-an-email', '', `${'a'.repeat(250)}@b.cd`, 42])(
      'rejects email %p',
      async (email) => {
        expect(await errorsOf(SignUpDto, { email, password: 'Secret123' })).toEqual(['email']);
      },
    );
  });

  it('SignInDto does not apply the password policy', async () => {
    expect(await errorsOf(SignInDto, { email: 'a@b.cd', password: 'x' })).toEqual([]);
    expect(await errorsOf(SignInDto, { email: 'a@b.cd', password: 'x'.repeat(257) })).toEqual([
      'password',
    ]);
  });

  it('EmailDto requires an email', async () => {
    expect(await errorsOf(EmailDto, {})).toEqual(['email']);
  });

  describe('codes', () => {
    it.each(['123456', '0000'])('accepts %p', async (code) => {
      expect(await errorsOf(VerifyEmailDto, { email: 'a@b.cd', code })).toEqual([]);
    });

    it.each(['12a456', '123', '12345678901', '-12345', '12.345', 123456])(
      'rejects %p',
      async (code) => {
        expect(await errorsOf(VerifyEmailDto, { email: 'a@b.cd', code })).toEqual(['code']);
      },
    );
  });

  it('ResetPasswordDto validates email, code and the new password', async () => {
    expect(
      await errorsOf(ResetPasswordDto, { email: 'a@b.cd', code: '123456', password: 'Secret123' }),
    ).toEqual([]);
    expect(await errorsOf(ResetPasswordDto, { email: 'x', code: 'x', password: 'x' })).toEqual([
      'email',
      'code',
      'password',
    ]);
  });

  it('RefreshTokenDto requires a JWT', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';

    expect(await errorsOf(RefreshTokenDto, { refreshToken: jwt })).toEqual([]);
    expect(await errorsOf(RefreshTokenDto, { refreshToken: 'nope' })).toEqual(['refreshToken']);
  });
});
