import { IsJWT, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_ID_TOKEN_LENGTH } from '../../../../common/constants';

export class GoogleSignInDto {
  /** The `credential` Google Identity Services gave the web app (a Google ID token). */
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_TOKEN_LENGTH)
  @IsJWT()
  idToken: string;
}
