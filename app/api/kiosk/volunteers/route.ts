import { z } from "zod";
import { setCurrentVolunteer } from "../_lib/session";
import { getKioskStore, KioskError } from "../_lib/store";
import { kioskError, ok, readJson, requireKioskApi } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/kiosk/volunteers — активные волонтёры из kiosk_volunteers.
export async function GET() {
  try {
    await requireKioskApi();
    return ok({ volunteers: await getKioskStore().listVolunteers() });
  } catch (e) {
    return kioskError(e);
  }
}

const Body = z.union([z.object({ id: z.string().min(1).max(80) }), z.object({ name: z.string().trim().min(2).max(80) })]);

// POST /api/kiosk/volunteers — выбрать волонтёра планшета: { id } из списка или { name } — новый (или найденный по имени).
// Ответ: { volunteer }. Выбор запоминается в cookie до конца дня.
export async function POST(req: Request) {
  try {
    await requireKioskApi();
    const body = Body.parse((await readJson(req)) ?? {});
    const store = getKioskStore();
    const volunteer = "id" in body ? await store.getVolunteer(body.id) : await store.addVolunteer(body.name);
    if (!volunteer) throw new KioskError("not_found", "Такого волонтёра нет в списке");
    await setCurrentVolunteer(volunteer.id);
    return ok({ volunteer });
  } catch (e) {
    return kioskError(e);
  }
}
