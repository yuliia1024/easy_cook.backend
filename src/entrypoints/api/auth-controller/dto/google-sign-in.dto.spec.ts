import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GoogleSignInDto } from './google-sign-in.dto';

const part = (value: object | string): string =>
  Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

describe('GoogleSignInDto', () => {
  const errors = (body: unknown) => validateSync(plainToInstance(GoogleSignInDto, body));
  const token = [part({ alg: 'RS256' }), part({ sub: '1' }), part('signature')].join('.');

  it('accepts a JWT', () => {
    expect(errors({ idToken: token })).toHaveLength(0);
  });

  it.each([
    {},
    { idToken: '' },
    { idToken: 'not-a-jwt' },
    { idToken: 42 },
    { idToken: `${token}${'a'.repeat(5000)}` },
  ])('rejects %p', (body) => {
    expect(errors(body)).not.toHaveLength(0);
  });
});
