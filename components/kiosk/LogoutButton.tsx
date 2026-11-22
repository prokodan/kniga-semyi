"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { kGhost } from "./ui";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={kGhost}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/kiosk/logout", { method: "POST" }).catch(() => undefined);
        router.replace("/kiosk");
        router.refresh();
      }}
    >
      Выйти
    </button>
  );
}
