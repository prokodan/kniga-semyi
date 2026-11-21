import { z } from "zod";
import { AccessError, findStoryteller, getFamilyStore, isOwnAudioPath } from "@/lib/db/access";
import { errorResponse, familyToken, ok, readJson, requireFamily } from "../_family/http";

export const dynamic = "force-dynamic";

const Body = z.object({ storytellerId: z.string().min(1), path: z.string().min(1).max(300) });

// POST /api/consent — голосовое согласие рассказчика загружено: { token, storytellerId, path }.
// Пишет storytellers.consent_audio_url + consent_at. Без этого /api/stories отвечает 409 consent_required.
export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const view = await requireFamily(familyToken(req, raw));
    const body = Body.parse(raw ?? {});
    const st = findStoryteller(view, body.storytellerId);
    if (!isOwnAudioPath(body.path, view.family.id, st.id, "consent")) throw new AccessError("bad_request", "Неверный путь записи");
    const saved = await getFamilyStore().saveConsent(st.id, body.path);
    return ok({ storytellerId: saved.id, consentAt: saved.consent_at });
  } catch (e) {
    return errorResponse(e);
  }
}
