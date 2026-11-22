import { z } from "zod";
import { setCurrentVolunteer } from "../_lib/session";
import { getKioskStore, KioskError } from "../_lib/store";
import { kioskError, ok, requireKioskApi } from "../_lib/http";

export const dynamic = "force-dynamic";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // браузер ужимает фото до ~300 КБ
const thisYear = new Date().getFullYear();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const Fields = z.object({
  name: z.string().trim().min(1, "Как зовут старейшину?").max(120),
  nameKo: optionalText(120),
  birthYear: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().int().min(1900).max(thisYear).nullable()),
  birthPlace: optionalText(160),
  volunteerId: optionalText(80),
  volunteerName: optionalText(80),
});

// POST /api/kiosk/families — карточка старейшины (multipart/form-data):
// name, nameKo?, birthYear?, birthPlace?, photo? (image/*), volunteerId? | volunteerName? (новый волонтёр).
// Создаёт families (source = 'kiosk') + storytellers. Ответ 201: { familyId, storytellerId, volunteerId, url }.
export async function POST(req: Request) {
  try {
    await requireKioskApi();
    const form = await req.formData();
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const f = Fields.parse({
      name: get("name"),
      nameKo: get("nameKo"),
      birthYear: get("birthYear"),
      birthPlace: get("birthPlace"),
      volunteerId: get("volunteerId"),
      volunteerName: get("volunteerName"),
    });

    const store = getKioskStore();
    const volunteer = f.volunteerId
      ? await store.getVolunteer(f.volunteerId)
      : f.volunteerName && f.volunteerName.length >= 2
        ? await store.addVolunteer(f.volunteerName)
        : null;
    if (!volunteer) throw new KioskError("bad_request", "Выберите, кто из волонтёров ведёт запись");

    let photo: { bytes: Uint8Array; contentType: string } | null = null;
    const file = form.get("photo");
    if (file && typeof file !== "string" && file.size > 0) {
      if (!file.type.startsWith("image/")) throw new KioskError("bad_request", "Фото должно быть картинкой");
      if (file.size > MAX_PHOTO_BYTES) throw new KioskError("bad_request", "Фото слишком большое — сделайте снимок ещё раз");
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
    }

    const { family, storyteller } = await store.createElder({
      name: f.name,
      name_ko: f.nameKo,
      birth_year: f.birthYear,
      birth_place: f.birthPlace,
      photo,
    });
    await setCurrentVolunteer(volunteer.id);
    return ok({ familyId: family.id, storytellerId: storyteller.id, volunteerId: volunteer.id, url: `/kiosk/session/${family.id}` }, 201);
  } catch (e) {
    return kioskError(e);
  }
}
