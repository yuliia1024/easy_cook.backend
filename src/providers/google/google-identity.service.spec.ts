import { InvalidGoogleTokenUnauthorizedException } from '../../common/exceptions';
import { AuthConfigService } from '../../configs/auth-config/auth-config.service';
import { GoogleIdentityService } from './google-identity.service';

const verifyIdToken = jest.fn();

jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn(() => ({ verifyIdToken })),
}));

describe('GoogleIdentityService', () => {
  const service = new GoogleIdentityService({
    googleClientId: 'client-id',
  } as AuthConfigService);
  const payload = {
    iss: 'https://accounts.google.com',
    sub: '1234',
    email: 'Cook@Example.com',
    email_verified: true,
    name: 'Cook',
    picture: 'https://lh3.googleusercontent.com/a/x',
    nonce: 'n-1',
  };

  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it('verifies the token for our client id and maps the account', async () => {
    verifyIdToken.mockResolvedValue({ getPayload: () => payload });

    await expect(service.verify('id-token')).resolves.toEqual({
      sub: '1234',
      email: 'cook@example.com',
      emailVerified: true,
      name: 'Cook',
      avatarUrl: 'https://lh3.googleusercontent.com/a/x',
      nonce: 'n-1',
    });
    expect(verifyIdToken).toHaveBeenCalledWith({ idToken: 'id-token', audience: 'client-id' });
  });

  it('treats a missing email_verified as unverified and missing names as null', async () => {
    verifyIdToken.mockResolvedValue({
      getPayload: () => ({ iss: 'accounts.google.com', sub: '1', email: 'a@b.c' }),
    });

    await expect(service.verify('t')).resolves.toMatchObject({
      emailVerified: false,
      name: null,
      avatarUrl: null,
      nonce: null,
    });
  });

  it('is 401 when Google rejects the token', async () => {
    verifyIdToken.mockRejectedValue(new Error('Token used too late: 1 > 0'));

    await expect(service.verify('t')).rejects.toBeInstanceOf(
      InvalidGoogleTokenUnauthorizedException,
    );
  });

  it.each([
    ['no email', { ...payload, email: undefined }],
    ['no subject', { ...payload, sub: undefined }],
    ['another issuer', { ...payload, iss: 'https://evil.example.com' }],
  ])('is 401 for a token with %s', async (_case, claims) => {
    verifyIdToken.mockResolvedValue({ getPayload: () => claims });

    await expect(service.verify('t')).rejects.toBeInstanceOf(
      InvalidGoogleTokenUnauthorizedException,
    );
  });
});
