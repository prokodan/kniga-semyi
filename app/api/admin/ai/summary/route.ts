// GET /api/admin/ai/summary — сводка админки ИИ в JSON (cookie админки обязательна).
import { NextResponse } from "next/server";
import { loadAdminData } from "@/app/admin/ai/_lib/data";
import { isAdmin } from "@/app/admin/ai/_lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "forbidden", message: "Нужен вход по PIN на /admin/ai" }, { status: 401 });
  }
  try {
    const data = await loadAdminData();
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    console.error("[admin/ai]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "internal", message: "Не удалось собрать сводку" }, { status: 500 });
  }
}
