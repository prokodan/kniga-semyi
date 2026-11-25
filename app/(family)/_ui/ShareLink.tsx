"use client";
import { useState } from "react";

// Ссылка на книгу: «отправить» (меню «Поделиться» телефона) и «скопировать».
export function ShareLink({ token, title }: { token: string; title: string }) {
  const [copied, setCopied] = useState(false);
  const url = () => `${window.location.origin}/f/${token}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url());
    } catch {
      window.prompt("Скопируйте ссылку:", url()); // старые браузеры без Clipboard API
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title, text: `Наша «Книга семьи»: ${title}. Здесь можно записывать рассказы:`, url: url() });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      }
    }
    await copy();
  }

  return (
    <div className="grid grid-cols-2 gap-3">
      <button type="button" onClick={() => void share()} className="rounded-button bg-ink px-4 py-3 text-paper">
        Отправить семье
      </button>
      <button type="button" onClick={() => void copy()} className="rounded-button border border-line bg-paper px-4 py-3">
        {copied ? "Скопировано ✓" : "Скопировать"}
      </button>
    </div>
  );
}
