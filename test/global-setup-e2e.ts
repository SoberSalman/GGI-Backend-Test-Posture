import 'dotenv/config';
import { Client } from 'pg';
import { DataSource } from 'typeorm';

/**
 * Creates the e2e database if it does not exist and brings it up to the latest
 * migration. Runs once before the suite, so tests can assume a real schema.
 */
export default async function globalSetup(): Promise<void> {
  const host = process.env.DB_HOST ?? 'localhost';
  const port = Number.parseInt(process.env.DB_PORT ?? '5432', 10);
  const user = process.env.DB_USER ?? 'ggi';
  const password = process.env.DB_PASSWORD ?? 'ggi_password';
  const database = process.env.E2E_DB_NAME ?? 'ggi_assessment_e2e';

  const admin = new Client({ host, port, user, password, database: 'postgres' });
  await admin.connect();

  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
  if (existing.rowCount === 0) {
    // Identifier cannot be parameterised; it comes from config, not user input.
    await admin.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
  }
  await admin.end();

  const dataSource = new DataSource({
    type: 'postgres',
    host,
    port,
    username: user,
    password,
    database,
    entities: [`${__dirname}/../src/**/domain/*.entity.ts`],
    migrations: [`${__dirname}/../src/migrations/*.ts`],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    logging: false,
  });

  await dataSource.initialize();
  await dataSource.runMigrations();
  await dataSource.destroy();
}
