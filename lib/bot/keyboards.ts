// Инлайн-клавиатуры. callback_data ≤ 64 байт: «раздел:аргумент».
import type { Keyboard } from "./telegram";
import { PREF_LABELS, type Prefs } from "./notify";
import type { Task } from "./tasks";

export const BACK: Keyboard = [[{ text: "⬅️ Меню", callback_data: "menu" }]];

export const MENU: Keyboard = [
  [
    { text: "📊 Прогресс", callback_data: "progress" },
    { text: "🧭 Очередь", callback_data: "queue" },
  ],
  [
    { text: "🔗 Ссылки", callback_data: "links" },
    { text: "🩺 Здоровье", callback_data: "health" },
  ],
  [
    { text: "📘 Инструкция Данилу", callback_data: "help:danil" },
    { text: "📗 Инструкция Владу", callback_data: "help:vlad" },
  ],
  [{ text: "🔔 Уведомления", callback_data: "prefs" }],
];

export function queueKeyboard(ready: Task[]): Keyboard {
  const rows: Keyboard = ready.slice(0, 12).map((t) => [
    { text: `✋ Взять ${t.code ?? `#${t.number}`}`, callback_data: `take:${t.number}` },
    { text: "📝 Промпт", callback_data: `prompt:${t.number}` },
  ]);
  return [...rows, [{ text: "🔄 Обновить", callback_data: "queue" }], ...BACK];
}

export const HEALTH: Keyboard = [
  [
    { text: "▶️ Запустить smoke", callback_data: "run:smoke" },
    { text: "🤖 Подобрать модели", callback_data: "run:ai-models" },
  ],
  [{ text: "🔄 Проверить ещё раз", callback_data: "health" }],
  ...BACK,
];

export function prefsKeyboard(p: Prefs): Keyboard {
  const keys = Object.keys(PREF_LABELS) as (keyof Prefs)[];
  return [...keys.map((k) => [{ text: `${p[k] ? "✅" : "⬜️"} ${PREF_LABELS[k]}`, callback_data: `pref:${k}` }]), ...BACK];
}

export const ROLE: Keyboard = [
  [
    { text: "Я Данил", callback_data: "role:danil" },
    { text: "Я Влад", callback_data: "role:vlad" },
  ],
];
