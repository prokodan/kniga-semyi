import { z } from "zod";
import { getCenterSource } from "../_lib/source";
import { centerError, loadCenter, ok, readJson, requireCenterApi } from "../_lib/http";

export const dynamic = "force-dynamic";

// GET /api/center/volunteers — все волонтёры (и отключённые) с числом сессий.
export async function GET() {
  try {
    await requireCenterApi();
    return ok({ volunteers: (await loadCenter()).volunteers });
  } catch (e) {
    return centerError(e);
  }
}

const Add = z.object({ name: z.string().trim().min(2).max(80) });

// POST /api/center/volunteers — { name }: добавить волонтёра (отключённого с тем же именем — включить обратно).
export async function POST(req: Request) {
  try {
    await requireCenterApi();
    const { name } = Add.parse((await readJson(req)) ?? {});
    return ok({ volunteer: await getCenterSource().addVolunteer(name) });
  } catch (e) {
    return centerError(e);
  }
}

const Toggle = z.object({ id: z.string().min(1).max(80), active: z.boolean() });

// PATCH /api/center/volunteers — { id, active }: отключить / включить. Отключённого нет в списке киоска,
// но его прошлые сессии сохраняются.
export async function PATCH(req: Request) {
  try {
    await requireCenterApi();
    const { id, active } = Toggle.parse((await readJson(req)) ?? {});
    return ok({ volunteer: await getCenterSource().setVolunteerActive(id, active) });
  } catch (e) {
    return centerError(e);
  }
}
