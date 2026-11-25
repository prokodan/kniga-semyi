import { z } from "zod";
import { interview } from "@/lib/interview";
import { errorResponse, familyToken, ok, readJson } from "@/lib/interview/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  familyId: z.string().min(1),
  storytellerId: z.string().min(1),
  mode: z.enum(["family", "kiosk"]).default("family"),
  volunteerId: z.string().min(1).nullish(),
});

// POST /api/sessions — начать интервью. Тело: { familyId, storytellerId, mode?, volunteerId?, token? }
// (токен ссылки семьи — заголовок x-family-token или поле token). Ответ 201: { sessionId, question, greeting, progress }.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const body = Body.parse(raw ?? {});
    const res = await interview.startSession({ ...body, volunteerId: body.volunteerId ?? null, token });
    return ok(res, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
