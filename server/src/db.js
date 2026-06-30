import pg from 'pg';
import { env } from './config/env.js';

const { Pool } = pg;

export const pool = new Pool(
  env.databaseUrl
    ? { connectionString: env.databaseUrl }
    : env.postgres
);

export function query(text, params) {
  return pool.query(text, params);
}

export async function transaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
