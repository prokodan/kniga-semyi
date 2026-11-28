import { interview } from "@/lib/interview";
import { errorResponse, familyToken, ok, readJson } from "@/lib/interview/http";
import { continueInBackground } from "@/lib/pipeline/chain";

export const dynamic = "force-dynamic";

// POST /api/sessions/:id/leave — #321: семья закрыла страницу записи (или ушла в другое приложение) на уточнении.
// Телефон шлёт navigator.sendBeacon с телом { token } (text/plain — без заголовков). Глава больше не ждёт
// FOLLOWUP_IDLE_MS (5 мин): отметка уточнения «давняя» → толкаем /process основной истории, она собирается сразу.
// Вернулись и ответили — свежая глава пересоберётся с ответом, как раньше. Ответ телефону не нужен (beacon).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const { storyId } = await interview.leave(id, { token });
    if (storyId) continueInBackground(req, storyId, token);
    return ok({ storyId });
  } catch (e) {
    return errorResponse(e);
  }
}
