"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { btnGhostCls } from "./ui";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={btnGhostCls}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/center/logout", { method: "POST" }).catch(() => undefined);
        router.replace("/center");
        router.refresh();
      }}
    >
      Выйти
    </button>
  );
}
