import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { InitialSchema1759700000000 } from './migrations/1759700000000-InitialSchema.js';
import { CatalogKindsAndEmailBody1759800000000 } from './migrations/1759800000000-CatalogKindsAndEmailBody.js';
import { ALL_ENTITIES } from './entities/index.js';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME,
  username: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  entities: ALL_ENTITIES,
  migrations: [InitialSchema1759700000000, CatalogKindsAndEmailBody1759800000000],
  migrationsTableName: 'migrations',
  synchronize: false,
  // Clever Cloud's plan allows only 5 connections for this user (DBeaver etc. count too).
  extra: { max: Number(process.env.DB_POOL_MAX ?? 2), idleTimeoutMillis: 10_000 },
};

export default new DataSource(dataSourceOptions);
