import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { configuration } from './configuration';

/**
 * Single place the TypeORM connection shape is defined, shared by the Nest
 * module and the CLI (`npm run migration:*`) so they can never drift apart.
 *
 * `synchronize` is off everywhere: schema changes go through migrations.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const { database, env } = configuration();

  return {
    type: 'postgres',
    host: database.host,
    port: database.port,
    username: database.username,
    password: database.password,
    database: database.database,
    logging: database.logging,
    synchronize: false,
    // Each chat request holds a connection for the length of its quota
    // transaction, so the pool is the real ceiling on concurrent requests.
    poolSize: database.poolSize,
    // The renewal transaction holds a row lock across the payment call, and a
    // chat request for the same user waits behind it. Without these a stalled
    // provider blocks that user indefinitely and never returns the connection.
    extra: {
      statement_timeout: database.statementTimeoutMs,
      lock_timeout: database.lockTimeoutMs,
    },
    entities: [`${__dirname}/../**/domain/*.entity.{ts,js}`],
    migrations: [`${__dirname}/../migrations/*.{ts,js}`],
    migrationsTableName: 'typeorm_migrations',
    // Fail fast on a bad DSN in dev rather than hanging the boot.
    connectTimeoutMS: env === 'production' ? 30_000 : 5_000,
  };
}

export default new DataSource(buildDataSourceOptions());
