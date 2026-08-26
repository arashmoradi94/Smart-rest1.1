"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    if (saved === "dark" || saved === "light") setTheme(saved);
  }, []);

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
