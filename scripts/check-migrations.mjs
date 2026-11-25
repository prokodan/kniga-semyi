// Прогоняет все миграции по порядку в PGlite (Postgres в памяти) — ловит ошибки SQL до слияния.
// Схема storage у Supabase своя, здесь подставляем заглушку storage.buckets и роль service_role.
// Запуск: npm run db:check
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const db = new PGlite();
await db.exec("create schema storage; create table storage.buckets(id text primary key, name text, public boolean);");
await db.exec("create role service_role nologin;");

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
  // Каждая таблица public должна быть доступна service_role (правило из AGENTS.md).
  const { rows: noGrant } = await db.query(
    `select c.relname as table_name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and not has_table_privilege('service_role', c.oid, 'select,insert,update,delete')`,
  );
  if (noGrant.length) {
    failed = true;
    console.error(`✗ нет grant'ов для service_role: ${noGrant.map((r) => r.table_name).join(", ")}`);
  } else {
    console.log("✓ service_role: права на все таблицы public");
  }
}
process.exit(failed ? 1 : 0);
