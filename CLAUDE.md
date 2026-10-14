# Easy Cook backend - conventions

NestJS 12 monolith, Prisma 7 (Postgres via `@prisma/adapter-pg`), Jest 30, TypeScript 6, Node 24 (`.nvmrc`). Single user, no auth. The web app is a separate
repository. Layout:

- `src/configs/` - one `*-config.service.ts` per area; every env var is declared and validated in `configs.ts`.
- `src/common/` - constants (enums, limits), exceptions, shared types, utils (`toNumber` for Prisma `Decimal`).
- `src/providers/` - wrappers around external clients (`OpenAiService` and `PrismaService`).
- `src/generated/prisma/` - Prisma client, generated on `npm install`, git-ignored. Import Prisma types
  from there (`../generated/prisma/client`), never from `@prisma/client`.
- `src/modules/data-access/<name>/` - repository + repository module; the only code that touches Prisma.
  Payload types (`RecipeWithIngredients`, ...) are exported from the repository file.
- `src/modules/services/<name>/` - business services. `NutritionService`, `energy-requirements.ts`
  and the menu `menu-composition.ts` / `menu-rules.ts` are pure and deterministic - keep the
  database and any LLM out of them.
- `src/modules/services/assistant/` - the `Assistant` port to the LLM; `StubAssistant` is bound until
  the LLM stage. Its output is untrusted: menus go through `MenuPlanner` / `MenuComposer`, and it
  never writes to the database.
- `src/entrypoints/api/<name>-controller/` - controller, controller service (orchestrates the flow,
  maps to response DTOs with `static from()`), DTOs.
- `prisma/schema/*.prisma` (one file per domain) + `prisma/migrations/` - create migrations with `NAME=... npm run migration:create`
  (needs `npm run infra:up`); applied on start-up. Never edit a committed migration.
- `scripts/` - dataset CLIs; their logic lives in `scripts/lib/` with specs. `data/seed/` is committed,
  `data/raw/` and `data/processed/` are not.

## Rules

- **Every new or changed piece of code ships with unit tests** - a `*.spec.ts` next to the file
  (services, controllers, repositories, configs, providers, DTO validation, scripts/lib). Use the
  helpers in `src/test/` (`createMock<T>()`, `createPrismaMock()`, `fakeConfig()`, `build*()` fixtures).
  API behaviour across layers goes into `test/*.e2e-spec.ts` (Supertest, test database).
- Before calling a task done run `npm run lint`, `npm run type-check`, `npm test`, `npm run test:e2e`
  and `npm run build`.
- Add explicit return types to methods you create or modify.
- New exceptions extend a base from `src/common/exceptions/app-error.ts` and live in the file named
  after their status (`bad-request.ts`, `conflict.ts`, ...). `exceptions.spec.ts` checks this.
- Register every new module in the module that uses it.
- Enum-like columns are `VARCHAR`; add values to the enums in `src/common/constants`, not to the DB.
- Food values are per 100 g of the food in its `state`; a recipe ingredient must reference the food
  in the state that is weighed (dry vs boiled rice). Null nutrient = unknown, never 0.
- Local ports: API 3100, Postgres 5442.
