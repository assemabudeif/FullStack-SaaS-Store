import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import type { Config } from '../config.js';

export type Row = Record<string, any>;
export interface Sql {
  query<T extends Row = Row>(text: string, values?: unknown[]): Promise<T[]>;
}
export interface Database extends Sql {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// PGlite uses one connection. Serialize ALL operations so unrelated reads/writes
// never accidentally execute inside another request's transaction.
export async function connectDatabase(config: Pick<Config, 'databaseUrl' | 'dataDir'>): Promise<Database> {
  if (config.databaseUrl) {
    const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, options: '-c timezone=UTC' });
    return {
      async query<T extends Row>(text: string, values: unknown[] = []) {
        return (await pool.query(text, values)).rows as T[];
      },
      async transaction<T>(fn: (sql: Sql) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const value = await fn({
            async query<R extends Row>(text: string, values: unknown[] = []) {
              return (await client.query(text, values)).rows as R[];
            },
          });
          await client.query('COMMIT');
          return value;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  mkdirSync(config.dataDir, { recursive: true });
  const engine = new PGlite(config.dataDir);
  await engine.waitReady;
  await engine.query("SET TIME ZONE 'UTC'");
  let tail: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.catch(() => {});
    return result;
  }
  const sql: Sql = {
    async query<T extends Row>(text: string, values: unknown[] = []) {
      return (await engine.query<T>(text, values)).rows;
    },
  };
  return {
    query: <T extends Row>(text: string, values?: unknown[]) => exclusive(() => sql.query<T>(text, values)),
    transaction: <T>(fn: (tx: Sql) => Promise<T>) => exclusive(() => engine.transaction(async (tx) =>
      fn({ async query<R extends Row>(text: string, values: unknown[] = []) {
        return (await tx.query<R>(text, values)).rows;
      } }))),
    close: () => exclusive(() => engine.close()),
  };
}
