import { z } from "zod";
import { audioPath, findStoryteller, getFamilyStore } from "@/lib/db/access";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "../_family/http";

export const dynamic = "force-dynamic";

const Body = z.object({
  storytellerId: z.string().min(1),
  kind: z.enum(["story", "consent"]),
  mime: z.string().min(3).max(100),
});

// POST /api/upload-url — подписанная ссылка на загрузку аудио прямо в Storage (bucket audio),
// мимо тела функции Vercel. Тело: { token, storytellerId, kind: "story" | "consent", mime }.
// Ответ: { path, signedUrl } — браузер делает PUT файла на signedUrl, затем шлёт path в /api/stories
// или /api/consent. signedUrl = null — база не настроена (локально), загрузку пропускаем.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const view = await requireFamily(familyToken(req, raw));
    const body = Body.parse(raw ?? {});
    const st = findStoryteller(view, body.storytellerId);
    const path = audioPath(view.family.id, st.id, body.kind, body.mime);
    const { signedUrl } = await getFamilyStore().signAudioUpload(path);
    return ok({ path, signedUrl });
  } catch (e) {
    return errorResponse(e);
  }
}
