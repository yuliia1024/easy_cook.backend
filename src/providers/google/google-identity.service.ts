import { Injectable, Logger } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { GOOGLE_ISSUERS } from '../../common/constants';
import { InvalidGoogleTokenUnauthorizedException } from '../../common/exceptions';
import { GoogleIdentity } from '../../common/types';
import { AuthConfigService } from '../../configs/auth-config/auth-config.service';

/**
 * Verifies a Google ID token (from Google Identity Services in the web app): the signature against
 * Google's keys, the expiry, the issuer and that it was issued for our client id.
 */
@Injectable()
export class GoogleIdentityService {
  private readonly logger = new Logger(GoogleIdentityService.name);
  private readonly client = new OAuth2Client();

  constructor(private readonly authConfig: AuthConfigService) {}

  public async verify(idToken: string): Promise<GoogleIdentity> {
    const payload = await this.client
      .verifyIdToken({ idToken, audience: this.authConfig.googleClientId })
      .then((ticket) => ticket.getPayload())
      .catch((error: Error) => {
        // The reason only: the token itself never goes to the logs.
        this.logger.warn(`Google ID token rejected: ${error.message.split(':')[0]}`);
        return undefined;
      });
    if (!payload?.sub || !payload.email || !GOOGLE_ISSUERS.includes(payload.iss)) {
      throw new InvalidGoogleTokenUnauthorizedException();
    }
    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
      name: payload.name ?? null,
      avatarUrl: payload.picture ?? null,
      nonce: payload.nonce ?? null,
    };
  }
}
