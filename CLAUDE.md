# Easy Cook backend - conventions

NestJS 11 monolith, TypeORM 0.3 (Postgres), Redis, Nodemailer. Layout mirrors `clearwire/backend`:

- `src/configs/` - one `*-config.service.ts` per area; every env var is declared and validated in `configs.ts`.
- `src/common/` - constants (enums, Redis keys), exceptions, decorators, shared types.
- `src/providers/` - wrappers around external clients (Redis, Nodemailer).
- `src/modules/data-access/<name>/` - entity + repository + repository module.
- `src/modules/services/<name>/` - business services.
- `src/entrypoints/api/<name>-controller/` - controller, controller service (orchestrates the flow), DTOs.
- `src/database/migrations/` - generated with `NAME=... npm run migration:generate` (needs `npm run infra:up`); applied on start-up. Never edit a committed migration.

## Rules

- **Every new or changed piece of code ships with unit tests** - a `*.spec.ts` next to the file
  (services, controllers, guards, repositories, configs, providers, DTO validation). Use the helpers
  in `src/test/` (`createMock<T>()`, `fakeConfig()`, `buildUser()`/`buildProfile()`).
- Before calling a task done run `npm run type-check`, `npm test` and `npm run build`.
- Add explicit return types to methods you create or modify.
- New exceptions extend a base from `src/common/exceptions/app-error.ts` and live in the file named
  after their status (`bad-request.ts`, `conflict.ts`, ...). `exceptions.spec.ts` checks this.
- Register every new module in the module that uses it.
- Login is email + password (no OTP on login). Emailed codes (`OtpService`) confirm email, password
  reset and email change. JWTs are valid only while stored in Redis (`AuthStorageService`).
- Local ports are deliberately different from clearwire: API 3100, Postgres 5442, Redis 6390,
  Mailpit 1035 / 8035.
