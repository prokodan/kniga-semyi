import { centerError, loadCenter, ok, requireCenterApi } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/center/summary[?demo=hide] — счётчики, семьи, волонтёры кабинета АКНЦ (нужен вход по ADMIN_PIN).
export async function GET(req: Request) {
  try {
    await requireCenterApi();
    const hideDemo = new URL(req.url).searchParams.get("demo") === "hide";
    return ok(await loadCenter({ hideDemo }));
  } catch (e) {
    return centerError(e);
  }
}
