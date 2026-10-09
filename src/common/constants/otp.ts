/** What an emailed one-time code confirms. Each type has its own code and cooldown. */
export enum OtpType {
  EmailVerification = 'email-verification',
  PasswordReset = 'password-reset',
  EmailChange = 'email-change',
}
