import {
  EmailNotAllowedForbiddenException,
  GoogleAccountMismatchForbiddenException,
  InvalidGoogleTokenUnauthorizedException,
  LoginNonceUnauthorizedException,
  UnverifiedEmailForbiddenException,
} from '../../../common/exceptions';
import { GoogleIdentity } from '../../../common/types';
import { generateSecureToken, hashToken } from '../../../common/utils';
import { AuthConfigService } from '../../../configs/auth-config/auth-config.service';
import { GoogleIdentityService } from '../../../providers/google/google-identity.service';
import { createMock } from '../../../test/create-mock';
import { buildUser, USER_ID } from '../../../test/fixtures';
import { AuthSessionRepository } from '../../data-access/auth-session/auth-session.repository';
import { UserRepository } from '../../data-access/user/user.repository';
import { AuthService } from './auth.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-23T12:00:00Z').getTime();

describe('AuthService', () => {
  let google: jest.Mocked<GoogleIdentityService>;
  let users: jest.Mocked<UserRepository>;
  let sessions: jest.Mocked<AuthSessionRepository>;
  let service: AuthService;
  const secret = 's'.repeat(32);
  const nonce = generateSecureToken();
  const identity: GoogleIdentity = {
    sub: 'google-1234',
    email: 'cook@example.com',
    emailVerified: true,
    name: 'Cook',
    avatarUrl: 'https://lh3.googleusercontent.com/a/x',
    nonce,
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    google = createMock<GoogleIdentityService>();
    users = createMock<UserRepository>();
    sessions = createMock<AuthSessionRepository>();
    google.verify.mockResolvedValue(identity);
    sessions.consumeLoginNonce.mockResolvedValue(true);
    users.update.mockImplementation(async (id, data) => buildUser({ id, ...data }));
    users.create.mockImplementation(async (data) => buildUser({ id: 'new-user', ...data }));
    service = new AuthService(google, users, sessions, {
      secret,
      allowedEmails: new Set(['new@example.com']),
    } as unknown as AuthConfigService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createLoginNonce', () => {
    it('stores the hash of a fresh nonce for 10 minutes', async () => {
      const created = await service.createLoginNonce();

      expect(created).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessions.saveLoginNonce).toHaveBeenCalledWith(hashToken(created), 600);
    });
  });

  describe('signInWithGoogle', () => {
    it('opens a session for the user of the Google account', async () => {
      users.findByGoogleSub.mockResolvedValue(buildUser());

      const signedIn = await service.signInWithGoogle('id-token', nonce, 'Firefox');

      expect(google.verify).toHaveBeenCalledWith('id-token');
      expect(sessions.consumeLoginNonce).toHaveBeenCalledWith(hashToken(nonce));
      expect(users.update).toHaveBeenCalledWith(USER_ID, {
        name: 'Cook',
        avatarUrl: 'https://lh3.googleusercontent.com/a/x',
        lastLoginAt: new Date(NOW),
      });
      expect(signedIn.user.id).toBe(USER_ID);
      expect(signedIn.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(sessions.create).toHaveBeenCalledWith(
        hashToken(signedIn.token),
        { userId: USER_ID, createdAt: NOW, lastSeenAt: NOW, userAgent: 'Firefox' },
        7 * 24 * 60 * 60,
      );
      expect(sessions.trimUserSessions).toHaveBeenCalledWith(USER_ID, 10);
      expect(service.isCsrfTokenValid(hashToken(signedIn.token), signedIn.csrfToken)).toBe(true);
    });

    it('gives every sign-in a new token and ends the session the browser had', async () => {
      users.findByGoogleSub.mockResolvedValue(buildUser());
      const previous = generateSecureToken();
      sessions.find.mockResolvedValue({
        userId: 'someone',
        createdAt: 0,
        lastSeenAt: 0,
        userAgent: null,
      });

      const signedIn = await service.signInWithGoogle('id-token', nonce, undefined, previous);

      expect(signedIn.token).not.toBe(previous);
      expect(sessions.delete).toHaveBeenCalledWith(hashToken(previous), 'someone');
      expect(sessions.create.mock.calls[0][1].userAgent).toBeNull();
    });

    it('caps a long user agent', async () => {
      users.findByGoogleSub.mockResolvedValue(buildUser());

      await service.signInWithGoogle('id-token', nonce, 'x'.repeat(2000));

      expect(sessions.create.mock.calls[0][1].userAgent).toHaveLength(512);
    });

    it('links the Google account to a user added by email', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(buildUser({ googleSub: null }));

      await service.signInWithGoogle('id-token', nonce, undefined);

      expect(users.findByEmail).toHaveBeenCalledWith('cook@example.com');
      expect(users.update).toHaveBeenCalledWith(
        USER_ID,
        expect.objectContaining({ googleSub: 'google-1234' }),
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('refuses an email linked to another Google account', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(buildUser({ googleSub: 'google-other' }));

      await expect(service.signInWithGoogle('id-token', nonce, undefined)).rejects.toBeInstanceOf(
        GoogleAccountMismatchForbiddenException,
      );
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('creates a user for an allowed email', async () => {
      google.verify.mockResolvedValue({ ...identity, email: 'new@example.com' });
      users.findByGoogleSub.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);

      const signedIn = await service.signInWithGoogle('id-token', nonce, undefined);

      expect(users.create).toHaveBeenCalledWith({
        email: 'new@example.com',
        googleSub: 'google-1234',
        name: 'Cook',
        avatarUrl: 'https://lh3.googleusercontent.com/a/x',
        lastLoginAt: new Date(NOW),
      });
      expect(signedIn.user.id).toBe('new-user');
    });

    it('refuses an email that is neither a user nor allowed', async () => {
      users.findByGoogleSub.mockResolvedValue(null);
      users.findByEmail.mockResolvedValue(null);

      await expect(service.signInWithGoogle('id-token', nonce, undefined)).rejects.toBeInstanceOf(
        EmailNotAllowedForbiddenException,
      );
      expect(users.create).not.toHaveBeenCalled();
    });

    it('refuses an unverified email before looking up any user', async () => {
      google.verify.mockResolvedValue({ ...identity, emailVerified: false });

      await expect(service.signInWithGoogle('id-token', nonce, undefined)).rejects.toBeInstanceOf(
        UnverifiedEmailForbiddenException,
      );
      expect(users.findByGoogleSub).not.toHaveBeenCalled();
    });

    it('passes on an invalid Google token', async () => {
      google.verify.mockRejectedValue(new InvalidGoogleTokenUnauthorizedException());

      await expect(service.signInWithGoogle('bad', nonce, undefined)).rejects.toBeInstanceOf(
        InvalidGoogleTokenUnauthorizedException,
      );
      expect(sessions.consumeLoginNonce).not.toHaveBeenCalled();
    });

    it.each([
      ['no nonce cookie', undefined, nonce],
      ['a malformed cookie', 'short', 'short'],
      ['no nonce in the token', nonce, null],
      ['the nonce of another browser', generateSecureToken(), nonce],
    ])('is 401 with %s', async (_case, cookieNonce, tokenNonce) => {
      google.verify.mockResolvedValue({ ...identity, nonce: tokenNonce });

      await expect(
        service.signInWithGoogle('id-token', cookieNonce, undefined),
      ).rejects.toBeInstanceOf(LoginNonceUnauthorizedException);
      expect(sessions.consumeLoginNonce).not.toHaveBeenCalled();
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('is 401 for a nonce used or expired already (a replayed token)', async () => {
      sessions.consumeLoginNonce.mockResolvedValue(false);

      await expect(service.signInWithGoogle('id-token', nonce, undefined)).rejects.toBeInstanceOf(
        LoginNonceUnauthorizedException,
      );
      expect(users.findByGoogleSub).not.toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    const token = generateSecureToken();
    const tokenHash = hashToken(token);
    const stored = (createdAgo: number, seenAgo: number) => ({
      userId: USER_ID,
      createdAt: NOW - createdAgo,
      lastSeenAt: NOW - seenAgo,
      userAgent: null,
    });

    it.each([undefined, '', 'not-a-token', 42])(
      'is null for %p without asking Redis',
      async (value) => {
        await expect(service.authenticate(value)).resolves.toBeNull();
        expect(sessions.find).not.toHaveBeenCalled();
      },
    );

    it('is null for an unknown session', async () => {
      sessions.find.mockResolvedValue(null);

      await expect(service.authenticate(token)).resolves.toBeNull();
      expect(sessions.find).toHaveBeenCalledWith(tokenHash);
    });

    it('returns the user without a write for a session used just now', async () => {
      sessions.find.mockResolvedValue(stored(DAY_MS, 60_000));
      users.findById.mockResolvedValue(buildUser());

      await expect(service.authenticate(token)).resolves.toEqual({
        user: buildUser(),
        tokenHash,
      });
      expect(sessions.touch).not.toHaveBeenCalled();
    });

    it('moves the idle expiry of a session unused for a while', async () => {
      sessions.find.mockResolvedValue(stored(DAY_MS, 10 * 60_000));
      users.findById.mockResolvedValue(buildUser());

      await service.authenticate(token);

      expect(sessions.touch).toHaveBeenCalledWith(
        tokenHash,
        { ...stored(DAY_MS, 0) },
        7 * 24 * 60 * 60,
      );
    });

    it('never moves it past the absolute expiry', async () => {
      sessions.find.mockResolvedValue(stored(13 * DAY_MS, 10 * 60_000));
      users.findById.mockResolvedValue(buildUser());

      await service.authenticate(token);

      expect(sessions.touch.mock.calls[0][2]).toBe(24 * 60 * 60);
    });

    it('ends a session past its absolute expiry', async () => {
      sessions.find.mockResolvedValue(stored(14 * DAY_MS, 0));

      await expect(service.authenticate(token)).resolves.toBeNull();
      expect(users.findById).not.toHaveBeenCalled();
      expect(sessions.delete).toHaveBeenCalledWith(tokenHash, USER_ID);
    });

    it('ends the session of a user who is gone', async () => {
      sessions.find.mockResolvedValue(stored(DAY_MS, 0));
      users.findById.mockResolvedValue(null);

      await expect(service.authenticate(token)).resolves.toBeNull();
      expect(sessions.delete).toHaveBeenCalledWith(tokenHash, USER_ID);
    });
  });

  describe('sign-out', () => {
    it('ends the session of the token', async () => {
      const token = generateSecureToken();
      sessions.find.mockResolvedValue({
        userId: USER_ID,
        createdAt: 0,
        lastSeenAt: 0,
        userAgent: null,
      });

      await service.signOut(token);

      expect(sessions.delete).toHaveBeenCalledWith(hashToken(token), USER_ID);
    });

    it('does nothing for a missing or unknown token', async () => {
      sessions.find.mockResolvedValue(null);

      await service.signOut(undefined);
      await service.signOut(generateSecureToken());

      expect(sessions.delete).not.toHaveBeenCalled();
    });

    it('ends every session of the user', async () => {
      await service.signOutEverywhere(USER_ID);

      expect(sessions.deleteAllOfUser).toHaveBeenCalledWith(USER_ID);
    });
  });

  it('accepts only the CSRF token of the session', () => {
    const csrf = service.csrfTokenFor('hash-a');

    expect(service.isCsrfTokenValid('hash-a', csrf)).toBe(true);
    expect(service.isCsrfTokenValid('hash-b', csrf)).toBe(false);
    expect(service.isCsrfTokenValid('hash-a', undefined)).toBe(false);
  });
});
