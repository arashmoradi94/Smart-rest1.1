"use client";

import { useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  // Read the DOM-applied theme during the first client render — no effect,
  // no cascading render. SSR fallback stays "light" like the current default.
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark"
      ? "dark"
      : "light",
  );

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {}
  }

  return (
    <button
      onClick={toggle}
      className="flex size-10 items-center justify-center rounded-xl transition hover:opacity-70"
      style={{ background: "rgba(100,116,139,.1)", color: "var(--muted)" }}
      aria-label={theme === "dark" ? "تم روشن" : "تم تیره"}
    >
      {theme === "dark" ? <Sun className="size-5" aria-hidden /> : <Moon className="size-5" aria-hidden />}
    </button>
  );
}
