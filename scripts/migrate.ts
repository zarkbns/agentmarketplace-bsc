/**
 * Migration runner — applies db/migrations/*.sql to the Supabase Postgres
 * database in order, tracking applied files in a schema_migrations table.
 *
 * Usage:
 *   npm run db:migrate
 *
 * Requires SUPABASE_DB_URL in the environment (SERVER ONLY).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { serverEnv } from "../lib/env";

async function main() {
  const env = serverEnv();
  if (!env.SUPABASE_DB_URL) {
    console.error("SUPABASE_DB_URL is not set. Add it to .env (see .env.example).");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL });
  await client.connect();
  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      );
    `);
    const files = readdirSync(join(process.cwd(), "db/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const { rowCount } = await client.query("select 1 from schema_migrations where filename = $1", [file]);
      if (rowCount && rowCount > 0) {
        console.log(`skip  ${file} (already applied)`);
        continue;
      }
      console.log(`apply ${file}`);
      const sql = readFileSync(join(process.cwd(), "db/migrations", file), "utf8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("Migration failed:", err.message ?? err);
  process.exit(1);
});
