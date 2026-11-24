-- Users (Google sign-in; the sessions live in Redis). The single-user data goes to the owner below.

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "google_sub" VARCHAR(255),
    "name" VARCHAR(255),
    "avatar_url" TEXT,
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");

-- The owner of the data saved before sign-in existed; signs in with Google like anyone else. Only
-- a database that has that data gets the owner: a new one has no user outside AUTH_ALLOWED_EMAILS.
INSERT INTO "users" ("id", "email", "updated_at")
SELECT gen_random_uuid(), 'jk10101999@gmail.com', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "user_profiles");

-- AlterTable: the profile the single-user app used (the oldest) becomes the owner's; any other
-- one (two concurrent first saves) was never reachable and goes with its menus and conversations.
ALTER TABLE "user_profiles" ADD COLUMN "user_id" UUID;

DELETE FROM "user_profiles"
WHERE "id" <> (SELECT "id" FROM "user_profiles" ORDER BY "created_at" ASC, "id" ASC LIMIT 1);

UPDATE "user_profiles"
SET "user_id" = (SELECT "id" FROM "users" WHERE "email" = 'jk10101999@gmail.com');

ALTER TABLE "user_profiles" ALTER COLUMN "user_id" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
