// Прогоняет все миграции по порядку в PGlite (Postgres в памяти) — ловит ошибки SQL до слияния.
// Схема storage у Supabase своя, здесь подставляем заглушку storage.buckets.
// Запуск: npm run db:check
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const db = new PGlite();
await db.exec("create schema storage; create table storage.buckets(id text primary key, name text, public boolean);");

let failed = false;
for (const f of files) {
  try {
    await db.exec(readFileSync(path.join(dir, f), "utf8"));
    console.log(`✓ ${f}`);
  } catch (e) {
    failed = true;
    console.error(`✗ ${f}: ${e.message}`);
    break;
  }
}
if (!failed) {
  const { rows } = await db.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name",
  );
  console.log(`таблицы: ${rows.map((r) => r.table_name).join(", ")}`);
}
process.exit(failed ? 1 : 0);
