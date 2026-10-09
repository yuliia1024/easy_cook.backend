import { Request } from 'express';

export interface AuthUser {
  userId: string;
  /** Id of the login session the access token belongs to (one per sign-in / device). */
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}
