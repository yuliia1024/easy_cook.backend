import 'dotenv/config';
import { join } from 'path';
import { DataSource } from 'typeorm';

/**
 * DataSource for the TypeORM CLI (`npm run migration:*`), run from `dist`. The application
 * itself applies pending migrations on start-up (`migrationsRun` in `DatabaseConfigService`).
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  username: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  synchronize: false,
  entities: [join(__dirname, '../modules/**/*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
});
