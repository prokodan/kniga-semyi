// Временная проба #52 (не сливать): какие форматы запроса принимает модель расшифровки Gemini.
const KEY = process.env.GEMINI_API_KEY;
const BASE = "https://generativelanguage.googleapis.com/v1beta";
function wav(sec = 1.5, rate = 16000) {
  const n = Math.floor(sec * rate), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000), 44 + i * 2);
  return buf.toString("base64");
}
const audio = { inline_data: { mime_type: "audio/wav", data: wav() } };
const SYS = 'Расшифруй аудио дословно. Ответ — только JSON: {"text": "...", "language": "ru"}';
const list = await (await fetch(`${BASE}/models?pageSize=200`, { headers: { "x-goog-api-key": KEY } })).json();
const models = (list.models ?? []).filter((m) => /transcri/i.test(m.name) || /transcri/i.test(m.displayName ?? ""));
console.log("модели:", models.map((m) => `${m.name} [${(m.supportedGenerationMethods ?? []).join(",")}] in=${m.inputTokenLimit}`).join("\n  "));
const variants = {
  "A как в проде (system + json + thinking low)": { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [audio, { text: "{}" }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4, thinkingConfig: { thinkingLevel: "low" } } },
  "B без thinking": { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [audio, { text: "{}" }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.4 } },
  "C без responseMimeType": { systemInstruction: { parts: [{ text: SYS }] }, contents: [{ role: "user", parts: [audio] }], generationConfig: { temperature: 0.4 } },
  "D без systemInstruction, инструкция в user": { contents: [{ role: "user", parts: [{ text: SYS }, audio] }], generationConfig: { responseMimeType: "application/json" } },
  "E минимум: только аудио": { contents: [{ role: "user", parts: [audio] }] },
  "F аудио + текст, без config": { contents: [{ role: "user", parts: [{ text: "Transcribe in Russian." }, audio] }] },
};
for (const m of models) {
  const id = m.name.replace(/^models\//, "");
  for (const [name, body] of Object.entries(variants)) {
    const r = await fetch(`${BASE}/models/${id}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": KEY }, body: JSON.stringify(body) });
    const t = await r.text();
    let note = t.replace(/\s+/g, " ").slice(0, 260);
    if (r.ok) { try { note = "OK: " + JSON.parse(t).candidates?.[0]?.content?.parts?.map((p) => p.text).join("").slice(0, 120); } catch {} }
    console.log(`${id} | ${name} | HTTP ${r.status} | ${note}`);
  }
}
