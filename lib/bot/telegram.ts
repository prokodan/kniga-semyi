// Минимальный клиент Telegram Bot API. Токен живёт только в URL запроса и никогда не логируется.

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type Keyboard = InlineButton[][];

export type SendOptions = { keyboard?: Keyboard; silent?: boolean };

export interface TelegramApi {
  send(chatId: number | string, html: string, opts?: SendOptions): Promise<void>;
  edit(chatId: number | string, messageId: number, html: string, opts?: SendOptions): Promise<void>;
  answer(callbackId: string, text?: string, alert?: boolean): Promise<void>;
}

export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel" };
export type TgMessage = { message_id: number; chat: TgChat; from?: TgUser; text?: string };
export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: { id: string; from: TgUser; data?: string; message?: TgMessage };
};

export const TG_LIMIT = 4096;

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Обрезает HTML-текст под лимит Telegram, не ломая сущности в конце. */
export function clip(html: string, limit = TG_LIMIT - 96): string {
  if (html.length <= limit) return html;
  return `${html.slice(0, limit).replace(/&[a-z]*$/i, "")}…`;
}

export function createTelegram(token: string, fetchImpl: typeof fetch = fetch): TelegramApi {
  async function call(method: string, payload: Record<string, unknown>) {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let desc = res.statusText;
      try {
        desc = ((await res.json()) as { description?: string }).description ?? desc;
      } catch {}
      // «message is not modified» — повторное нажатие той же кнопки, это не ошибка.
      if (/not modified/i.test(desc)) return;
      throw new Error(`Telegram ${method}: ${res.status} ${desc}`.slice(0, 200));
    }
  }
  const markup = (k?: Keyboard) => (k ? { reply_markup: { inline_keyboard: k } } : {});
  return {
    send: (chatId, html, o) =>
      call("sendMessage", {
        chat_id: chatId,
        text: clip(html),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        disable_notification: o?.silent ?? false,
        ...markup(o?.keyboard),
      }),
    edit: (chatId, messageId, html, o) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: messageId,
        text: clip(html),
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
        ...markup(o?.keyboard),
      }),
    answer: (id, text, alert) => call("answerCallbackQuery", { callback_query_id: id, text, show_alert: alert ?? false }),
  };
}
