import {
  csrfTokenFor,
  generateSecureToken,
  hashToken,
  isCsrfTokenValid,
  isSecureTokenShaped,
  safeEqual,
} from './secure-token';

describe('session tokens', () => {
  const secret = 's'.repeat(32);

  it('generates distinct url-safe tokens of 32 bytes', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();

    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(isSecureTokenShaped(a)).toBe(true);
  });

  it.each([undefined, '', 'short', 'x'.repeat(43) + '=', 'a b'.repeat(15), 42])(
    'does not take %p for a token',
    (value) => {
      expect(isSecureTokenShaped(value)).toBe(false);
    },
  );

  it('hashes with sha256', () => {
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('accepts only the CSRF token of the same session and secret', () => {
    const token = csrfTokenFor('hash-a', secret);

    expect(isCsrfTokenValid('hash-a', secret, token)).toBe(true);
    expect(isCsrfTokenValid('hash-b', secret, token)).toBe(false);
    expect(isCsrfTokenValid('hash-a', 'o'.repeat(32), token)).toBe(false);
    expect(isCsrfTokenValid('hash-a', secret, token.slice(1))).toBe(false);
    expect(isCsrfTokenValid('hash-a', secret, undefined)).toBe(false);
    expect(isCsrfTokenValid('hash-a', secret, [token])).toBe(false);
  });

  it('compares strings in constant time, rejecting non-strings', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'ab')).toBe(false);
    expect(safeEqual('abc', null)).toBe(false);
  });
});
