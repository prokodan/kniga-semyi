import { z } from "zod";
import { getKioskStore, KioskError } from "../../../_lib/store";
import { kioskError, ok, readJson, requireKioskApi } from "../../../_lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ consent: z.boolean() });

// POST /api/kiosk/families/:id/archive — отдельная галочка семьи «передать в архив АКНЦ»: { consent: true | false }.
// Пишет families.archive_consent. Только для семей киоска.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireKioskApi();
    const { id } = await ctx.params;
    const { consent } = Body.parse((await readJson(req)) ?? {});
    if (!(await getKioskStore().setArchiveConsent(id, consent))) throw new KioskError("not_found", "Карточка не найдена");
    return ok({ familyId: id, archiveConsent: consent });
  } catch (e) {
    return kioskError(e);
  }
}
