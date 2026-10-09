import { UserResponseDto } from '../../dto/user.response.dto';

export class TokensResponseDto {
  accessToken: string;
  refreshToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
}

export class AuthResponseDto extends TokensResponseDto {
  user: UserResponseDto;
}

export class SignUpResponseDto {
  /** A confirmation code was sent here. */
  email: string;
}
