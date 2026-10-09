import { OtpType } from './otp';

export enum TokenType {
  Access = 'access',
  Refresh = 'refresh',
}

export const REDIS_KEYS = {
  /** `auth:{access|refresh}:{userId}:{sessionId}` -> the issued JWT. */
  authToken: (type: TokenType, userId: string, sessionId: string): string =>
    `auth:${type}:${userId}:${sessionId}`,
  authTokenPattern: (userId: string): string => `auth:*:${userId}:*`,
  /** Hash: `codeHash`, `attempts`, optional `payload`. */
  otp: (type: OtpType, subjectId: string): string => `otp:${type}:${subjectId}`,
  otpCooldown: (type: OtpType, subjectId: string): string => `otp:cooldown:${type}:${subjectId}`,
};
