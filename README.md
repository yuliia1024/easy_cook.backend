# Easy Cook backend

NestJS 11 monolith · TypeORM 0.3 · PostgreSQL 16 · Redis 7 · Nodemailer.
Structure follows `clearwire/backend`: `configs/`, `common/`, `providers/`, `modules/data-access`, `modules/services`, `entrypoints/api`.

## Ports (chosen so they don't clash with clearwire)

| Service  | Host port | clearwire uses |
|----------|-----------|----------------|
| API      | 3100      | 3002           |
| Postgres | 5442      | 5432 / 5433    |
| Redis    | 6390      | 6379 / 6380    |
| Mailpit SMTP / UI | 1035 / [8035](http://localhost:8035) | — |

## Run

```bash
cp .env.example .env          # set the JWT secrets
npm run infra:up              # postgres + redis + mailpit
npm run start:dev             # API on http://localhost:3100/api, Swagger on /docs
# or everything in docker:
npm run compose
```

Migrations run automatically on start-up. New one: `NAME=add-something npm run migration:generate`.
Emails are caught locally by Mailpit — open http://localhost:8035 to read the codes.

## Tests

```bash
npm test            # unit tests (Jest, *.spec.ts next to each file)
npm run test:cov    # + coverage report in ./coverage
```

Shared helpers live in `src/test/`: `createMock<T>()` (auto-mocks every method), `fakeConfig()`,
fixtures (`buildUser`, `buildProfile`). Every new piece of code ships with its spec.

## Auth

- Sign-in is email + password only (no OTP on login).
- Emailed numeric codes (OTP) confirm: the email after sign-up, password reset, email change.
  Codes are hashed in Redis, expire in `OTP_TTL_IN_SEC`, allow `OTP_MAX_ATTEMPTS` tries and can be
  re-sent once per `OTP_RESEND_COOLDOWN_IN_SEC`.
- JWT access + refresh tokens are stored in Redis per session
  (`auth:{access|refresh}:{userId}:{sessionId}`); a token not found there is rejected, so sign-out
  and password changes take effect immediately. Refresh tokens are single use (rotation).

| Method | Path | |
|---|---|---|
| POST | `/api/auth/sign-up` | creates an unverified user, emails a code |
| POST | `/api/auth/verify-email` | `{email, code}` → tokens + user |
| POST | `/api/auth/verify-email/resend` | |
| POST | `/api/auth/sign-in` | 403 while the email is unverified |
| POST | `/api/auth/refresh` | |
| POST | `/api/auth/sign-out`, `/api/auth/sign-out-all` | bearer |
| POST | `/api/auth/forgot-password`, `/api/auth/reset-password` | |
| GET  | `/api/users/me` | includes `isProfileCompleted` |
| GET  | `/api/users/profile/options` | allowed genders / diets |
| PUT / PATCH | `/api/users/me/profile` | questionnaire: `firstName`, `gender`, `diet` |
| POST | `/api/users/me/password` | signs out the other sessions |
| POST | `/api/users/me/email`, `/api/users/me/email/confirm` | change email with a code sent to the new address |
