import { z } from "zod";
import { getFamilyStore } from "@/lib/db/access";
import { flag } from "@/lib/flags";
import { parseStartChoices, StartChoiceError } from "@/lib/interview/start-choices";
import { errorResponse, ok } from "../_family/http";

export const dynamic = "force-dynamic";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // браузер ужимает фото до ~300 КБ; запас под лимит тела Vercel
const thisYear = new Date().getFullYear();

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const Fields = z.object({
  name: z.string().trim().min(1, "Назовите книгу").max(120),
  storytellerName: z.string().trim().min(1, "Как зовут рассказчика?").max(120),
  storytellerNameKo: optionalText(120),
  birthYear: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? Number(v) : null))
    .pipe(z.number().int().min(1900).max(thisYear).nullable()),
  birthPlace: optionalText(160),
  giftDate: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  contact: optionalText(160),
});

// POST /api/families — создать книгу семьи и рассказчика. multipart/form-data:
// name, storytellerName, storytellerNameKo?, birthYear?, birthPlace?, giftDate? (YYYY-MM-DD), contact?, photo? (image/*).
// #233 (флаг culture_packs): packs (несколько: koryo | kz | ua | general), spoken (ru,koryo | ru | ru,kk | kk),
// book (ru,ko | ru,kk | ru) → families.culture_packs / book_langs, storytellers.spoken_langs. Флаг выключен — поля
// не читаются, семья получает умолчания базы (как сейчас).
// Ответ 201: { familyId, storytellerId, token, url: "/f/<token>" }.
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const get = (k: string) => {
      const v = form.get(k);
      return typeof v === "string" ? v : undefined;
    };
    const f = Fields.parse({
      name: get("name"),
      storytellerName: get("storytellerName"),
      storytellerNameKo: get("storytellerNameKo"),
      birthYear: get("birthYear"),
      birthPlace: get("birthPlace"),
      giftDate: get("giftDate"),
      contact: get("contact"),
    });

    let langs: ReturnType<typeof parseStartChoices> | undefined;
    const packs = form.getAll("packs").filter((v): v is string => typeof v === "string");
    // анкеты нет (старая форма, скрипты, e2e без выбора) — умолчания базы, как сейчас
    if (flag("culture_packs") && (packs.length > 0 || form.has("spoken") || form.has("book"))) {
      try {
        langs = parseStartChoices({ packs, spoken: get("spoken"), book: get("book") }, flag("lang_kk"));
      } catch (e) {
        if (e instanceof StartChoiceError) return ok({ error: "bad_request", message: e.message }, 400);
        throw e;
      }
    }

    let photo: { bytes: Uint8Array; contentType: string } | null = null;
    const file = form.get("photo");
    if (file && typeof file !== "string" && file.size > 0) {
      if (!file.type.startsWith("image/")) return ok({ error: "bad_request", message: "Фото должно быть картинкой" }, 400);
      if (file.size > MAX_PHOTO_BYTES) return ok({ error: "bad_request", message: "Фото слишком большое — выберите другое" }, 413);
      photo = { bytes: new Uint8Array(await file.arrayBuffer()), contentType: file.type };
    }

    const { family, storyteller } = await getFamilyStore().createFamily({
      name: f.name,
      gift_date: f.giftDate,
      contact: f.contact,
      storyteller: { name: f.storytellerName, name_ko: f.storytellerNameKo, birth_year: f.birthYear, birth_place: f.birthPlace },
      photo,
      ...(langs ? { langs } : {}),
    });
    return ok({ familyId: family.id, storytellerId: storyteller.id, token: family.access_token, url: `/f/${family.access_token}` }, 201);
  } catch (e) {
    return errorResponse(e);
  }
}
