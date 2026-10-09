import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1791489644537 implements MigrationInterface {
  name = 'Init1791489644537';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "email" character varying(254) NOT NULL, "password" character varying NOT NULL, "isEmailVerified" boolean NOT NULL DEFAULT false, "emailVerifiedAt" TIMESTAMP WITH TIME ZONE, "lastLoginAt" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email") `);
    await queryRunner.query(
      `CREATE TYPE "public"."user_gender" AS ENUM('male', 'female', 'other')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."user_diet" AS ENUM('omnivore', 'vegetarian', 'vegan', 'pescatarian', 'flexitarian', 'keto', 'paleo')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_profiles" ("createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "firstName" character varying(50) NOT NULL, "gender" "public"."user_gender" NOT NULL, "diet" "public"."user_diet" NOT NULL, CONSTRAINT "REL_8481388d6325e752cd4d7e26c6" UNIQUE ("userId"), CONSTRAINT "PK_1ec6662219f4605723f1e41b6cb" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_8481388d6325e752cd4d7e26c6d" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_profiles" DROP CONSTRAINT "FK_8481388d6325e752cd4d7e26c6d"`,
    );
    await queryRunner.query(`DROP TABLE "user_profiles"`);
    await queryRunner.query(`DROP TYPE "public"."user_diet"`);
    await queryRunner.query(`DROP TYPE "public"."user_gender"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
