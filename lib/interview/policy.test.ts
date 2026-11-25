import { describe, expect, it } from "vitest";
import { createQuestionBank } from "./bank";
import { candidateQuestions, decideAfterCompleteness, detectSignal, isBlockDone, MAX_FOLLOWUPS } from "./policy";

const bank = createQuestionBank();
const q = bank.first();

describe("policy", () => {
  it.each([
    ["Об этом не хочу говорить, давайте дальше.", "refuses"],
    ["Не спрашивайте меня про это.", "refuses"],
    ["(плачет) Простите…", "emotional"],
    ["Тяжело вспоминать то время.", "emotional"],
    ["Не могу об этом говорить, не хочу говорить.", "refuses"],
    ["Жили мы в Уштобе, в саманном доме.", null],
  ])("detectSignal(%s) = %s", (text, expected) => {
    expect(detectSignal(text)).toBe(expected);
  });

  it(`не больше ${MAX_FOLLOWUPS} уточнений`, () => {
    const res = { covered: [], missing: ["когда"], followup: "А когда это было?", done: false, offTopicBlock: null };
    const ctx = { question: q, bank, answeringFollowup: true };
    expect(decideAfterCompleteness(res, { ...ctx, state: { followups_asked: 2 } }).kind).toBe("followup");
    expect(decideAfterCompleteness(res, { ...ctx, state: { followups_asked: 3 } }).kind).toBe("accept");
    expect(decideAfterCompleteness(res, { ...ctx, state: { followups_asked: 0, emotional_pause: true } }).kind).toBe("accept");
  });

  it("done от модели — не давим, даже если что-то missing", () => {
    const res = { covered: [], missing: ["когда"], followup: "А когда?", done: true, offTopicBlock: null };
    expect(decideAfterCompleteness(res, { question: q, bank, answeringFollowup: false, state: {} }).kind).toBe("accept");
  });

  it("offTopicBlock своего же блока — не уход в сторону", () => {
    const res = { covered: q.minimum, missing: [], followup: null, done: true, offTopicBlock: q.block };
    expect(decideAfterCompleteness(res, { question: q, bank, answeringFollowup: false, state: {} }).kind).toBe("accept");
  });

  it("кандидаты: первый открытый вопрос каждого блока, «позже» — в конце", () => {
    const all = bank.all();
    const later = all[0]!.id;
    const answered = all.slice(1).map((x) => x.id);
    expect(candidateQuestions(bank, { later_question_ids: [later] }).map((x) => x.id)).not.toContain(later);
    expect(candidateQuestions(bank, { later_question_ids: [later], answered_question_ids: answered }).map((x) => x.id)).toEqual([later]);
    const firstBlock = bank.inBlock(all[0]!.block).map((x) => x.id);
    expect(isBlockDone(bank, { skipped_question_ids: firstBlock }, all[0]!.block)).toBe(true);
    if (firstBlock.length > 1) expect(isBlockDone(bank, { skipped_question_ids: [firstBlock[0]!] }, all[0]!.block)).toBe(false);
  });
});
