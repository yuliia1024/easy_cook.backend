# Easy Cook backend - conventions

NestJS 12 monolith, Prisma 7 (Postgres via `@prisma/adapter-pg`), Jest 30, TypeScript 6, Node 24 (`.nvmrc`). Single user, no auth. The web app is a separate
repository. Layout:

- `src/configs/` - one `*-config.service.ts` per area; every env var is declared and validated in `configs.ts`.
- `src/common/` - constants (enums, limits), exceptions, shared types, contracts, utils (`toNumber` for Prisma `Decimal`).
  `contracts/` holds only zod schemas that validate data from outside at run time (model output)
  and the types inferred from them; plain TypeScript types, the chat stream protocol included,
  go into `types/`.
- `src/providers/` - wrappers around external clients (`LlmService`, `EmbeddingService`, `PrismaService`).
  `LlmService` (`providers/llm/`) is the only code that calls an LLM (AI SDK): `MODEL_PROVIDERS` in
  order (OpenAI, then DeepSeek), retried and switched on a 5xx, timeout or rate limit by
  `ModelFallback`, per step of a tool loop (never around the loop: a tool must not run twice); every
  response is logged with its provider. A vendor (pinned model, key, client, `providerOptions`) is
  one file in `providers/llm/vendors/` registered in `MODEL_VENDORS`; nothing outside the provider
  knows which model answered. Models are pinned snapshots (`OPEN_AI_MODEL`, `DEEPSEEK_MODEL`,
  `ANTHROPIC_MODEL`), never aliases.
- Recipe search (RAG, `modules/services/recipe-search/`, notes in `docs/notes/rag-recipe-search.md`):
  hybrid search - pgvector cosine (HNSW) + Postgres full-text, both pre-filtered in SQL (meal, diet,
  allergens, time), fused by RRF (`RecipeSearchService`). `EmbeddingService` (`src/providers/embedding/`)
  is the only code that calls an embedding model: `EMBEDDING_PROVIDERS` in order (local Ollama, then
  OpenAI), models pinned in `EMBEDDING_MODELS`, `vector(1024)`. Used by the chat tool `search_recipes`
  (a query in the user's words; without one it lists by filters) and by `MenuPlannerService` for the
  `wishes` of a menu request ("more fish": the found recipes take up to `MENU_PLAN_WISHED_SHARE`
  of the candidates of a meal). A search is `matched` when its best recipe reaches the calibrated
  `matchSimilarity` of the model or a recipe has every word of the query; otherwise its hits are
  only similar: `search_recipes` returns them as `similar`, and the planner makes a wish offer
  (`messages.wish_offer`, `data-wish-offer`) answered by a message (intent `wishOffer`) or a button
  (`SendMessageDto.wishOffer`) instead of a menu. Recalibrate the threshold with
  `npm run eval:retrieval` (`match` / `no-match`) when the model changes. Vectors are keyed by model
  (`embeddingModelKey`), one HNSW index for all models (a query filters by model with an iterative
  scan); no provider -> full-text alone. A recipe is
  one document (`buildRecipeDocument`, raise `RECIPE_DOCUMENT_VERSION` on any change), indexed by
  `npm run search:index` (incremental by content hash). Never log the query text. Specs and e2e use
  `src/test/fake-embeddings.ts`, never a real model. Prisma cannot declare the HNSW index, so
  `migration:create` takes its `DROP INDEX` out of a new migration (`scripts/lib/unmanaged-indexes.ts`);
  never run a bare `prisma migrate dev`, it would drop the index.
- `src/generated/prisma/` - Prisma client, generated on `npm install`, git-ignored. Import Prisma types
  from there (`../generated/prisma/client`), never from `@prisma/client`.
- `src/modules/data-access/<name>/` - repository + repository module; the only code that touches Prisma.
  Payload types (`RecipeWithIngredients`, ...) are exported from the repository file.
- `src/modules/services/<name>/` - business services. `NutritionService`, `energy-requirements.ts`
  and the menu `menu-composition.ts` / `menu-rules.ts` are pure and deterministic - keep the
  database and any LLM out of them.
- Chat flow: `ChatOrchestratorService` routes a message by `IntentService` to `GeneralChatService` or
  `MenuPlannerService` (plan / revise a menu via `LlmService`) and streams the events. Model
  output is untrusted: menus go through `MenuComposer` and the menu rules, and only `MenuService`
  writes them; `menu-diff.ts` checks a revision changes nothing outside its scope.
- Chat tools (`modules/services/chat-tools/`): `GeneralChatService` runs the model with tools via
  `LlmService.streamWithTools` (`CHAT_TOOL_MAX_STEPS`). Every tool is declared in the registry
  with a zod input schema (`contracts/chat-tools.ts`) and an operation: `read` (returns data
  through a service) or `service_call` (`plan_menu` / `revise_menu`: only recorded, then the
  orchestrator runs it on the classified-request path). Tool errors go back to the model, never 500.
  A running read tool streams a `status` step (`CHAT_TOOL_STATUS`).
- Chat trace (`modules/services/chat-trace/`): with `ENV=local` every chat message is logged once,
  when the reply ends, as one JSON (`ChatTraceRecord`): request, context, intent, menu request,
  route, tool calls with input/output, menu plan, model calls, events, saved reply or error. Elsewhere it is off
  (user messages stay out of shared logs). New steps of the chain go into `ChatTraceStep`. In every
  environment each message ends with one summary line (`ChatReplySummary`): time, first text, model
  calls and tokens summed over the request (`recordModelCall` in the request context), tool calls.
  `LlmService` logs every step of a tool loop with its timing and every unfinished (aborted /
  failed) call; the registry logs every tool run with its call id and time, never its arguments.
- Agent runs (`modules/services/agent-run/`, table `agent_runs`): the audit log of the chat agent,
  one row per user message written in the orchestrator's `finally` whatever the outcome (a write
  tool in a failed reply is on record too): request id, user / reply message, outcome, timings,
  tokens, `ModelCallRecord[]` and `ChatToolCall[]` with tool call ids. Kept when the conversation
  is deleted (ids set null); only added, never updated. A failed write is logged, never fails the reply.
- `src/entrypoints/api/<name>-controller/` - controller, controller service (orchestrates the flow,
  maps to response DTOs with `static from()`), DTOs.
- `prisma/schema/*.prisma` (one file per domain) + `prisma/migrations/` - create migrations with `NAME=... npm run migration:create`
  (needs `npm run infra:up`); applied on start-up. Never edit a committed migration.
- `scripts/` - dataset CLIs; their logic lives in `scripts/lib/` with specs. `data/seed/` is committed,
  `data/raw/` and `data/processed/` are not.
- Catalog translations: tables `food_item_translations`, `recipe_translations`,
  `recipe_ingredient_translations`, keyed by (row, `Locale`); the main columns stay English (search,
  prompts, evals use them). Seeded from `data/seed/translations/<locale>.json` (validated by
  `npm run data:validate`), returned by the API as `translations: { uk: {...} }`, searched by the
  food / recipe name filters and added to the recipe search document. A new English name or text
  through the API drops the translations of the old one.
- `evals/` - prompt evals on the real model (`npm run eval`, not in `npm test`): cases in
  `suites/<name>/cases.jsonl`, runner logic in `lib/` with specs, committed `baselines/`,
  git-ignored `reports/`. A prompt change must not be worse than the baseline. The `Evals`
  workflow runs on a pull request only the suites / tags its changes touch (`--changed-since`):
  code a suite runs goes into `suites/triggers.ts`. Retrieval evals of the recipe search live apart
  in `evals/retrieval/` (`npm run eval:retrieval`: Recall@k, nDCG@k, MRR… per mode, graded cases by
  seed slug, a baseline per embedding model; workflow `Retrieval evals`).

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
- Every prompt is a `ModelPrompt` with a `version` (`src/common/constants/open-ai.ts`; the evals
  judge in `evals/lib/judge.ts`). Changing its text means raising the version; `open-ai.spec.ts`
  pins the hash of every released version. The model and prompt version go to the logs, to
  `MenuVersion.notes` and to the eval reports and baselines.
- Local ports: API 3100, Postgres 5442, Ollama 11434 (`npm run infra:embeddings`).
