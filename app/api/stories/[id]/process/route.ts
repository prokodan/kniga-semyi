import { z } from "zod";
import { familyToken, ok, readJson } from "@/lib/interview/http";
import { pipeline, PIPELINE_STEPS } from "@/lib/pipeline";
import { chainDepth, continueInBackground } from "@/lib/pipeline/chain";
import { pipelineError } from "@/lib/pipeline/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  /** Выполнить именно этот шаг (должен быть следующим по данным) */
  step: z.enum(PIPELINE_STEPS).optional(),
  /** Пересобрать с шага: очистить его результат и всех следующих, затем выполнить его */
  from: z.enum(PIPELINE_STEPS).optional(),
  token: z.string().optional(),
  /** Кнопка «Перезапустить сборку»: продолжить с застрявшего шага, не дожидаясь аренды; обнулить kick-stuck */
  restart: z.boolean().optional(),
});

// POST /api/stories/:id/process — запустить или продолжить конвейер по уже созданной строке stories.
// Один вызов = один шаг. Ответ: { storyId, status, ran, next, done, queued, retryInMinutes?, error, message }.
// Следующий шаг сервер запускает сам (lib/pipeline/chain.ts) — экран можно закрыть. running: true — шаг уже идёт.
// queued → «глава будет готова через N минут» (продолжит экран главы или workflow kick-stuck).
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raw = await readJson(req);
    const token = familyToken(req, raw);
    if (!token) return ok({ error: "forbidden", message: "Нужна ссылка семьи" }, 403);
    const body = Body.parse(raw ?? {});
    const res = body.from
      ? await pipeline.rebuild(id, body.from, { token })
      : await pipeline.runStep(id, { step: body.step, token, restart: body.restart });
    if (res.next && !res.queued && !res.running && !res.waiting && res.status !== "failed") continueInBackground(req, id, token, chainDepth(req));
    // #98: поздний ответ на уточнение — основная глава сброшена на edit, сервер её пересобирает
    if (res.rebuildParent) continueInBackground(req, res.rebuildParent, token);
    return ok(res, res.queued ? 202 : 200);
  } catch (e) {
    return pipelineError(e);
  }
}
