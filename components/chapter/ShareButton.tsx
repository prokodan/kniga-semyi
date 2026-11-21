"use client";
import { useState } from "react";

// «Отправить семье»: меню «Поделиться» телефона (Web Share API), запасной вариант — копирование,
// WhatsApp и Telegram. Отправляется публичная ссылка на голос (без токена семьи — её нельзя использовать для записи).
export function ShareButton({ url, title, text }: { url: string; title: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [more, setMore] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Скопируйте ссылку:", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    setMore(true);
  }

  const msg = encodeURIComponent(`${text} ${url}`);
  const link = "flex items-center justify-center rounded-button border border-line bg-paper px-4 py-3 text-ink";

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => void share()} className="button rounded-button bg-seal px-6 py-4 text-elder font-semibold text-paper active:bg-seal-dark">
        Отправить семье
      </button>
      {!more && (
        <button type="button" onClick={() => setMore(true)} className="text-ink-soft underline underline-offset-4">
          Другие способы
        </button>
      )}
      {more && (
        <div className="grid grid-cols-3 gap-2">
          <a className={`${link} min-h-12`} href={`https://wa.me/?text=${msg}`} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a
            className={`${link} min-h-12`}
            href={`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Telegram
          </a>
          <button type="button" onClick={() => void copy()} className={link}>
            {copied ? "Готово ✓" : "Ссылка"}
          </button>
        </div>
      )}
    </div>
  );
}
