"use client";

import { useEffect } from "react";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const stored = localStorage.getItem("theme");
    const theme =
      stored === "dark" || (!stored && matchMedia("(prefers-color-scheme: dark)").matches)
        ? "dark"
        : "light";
    document.documentElement.dataset.theme = theme;
  }, []);

  return <SessionProvider>{children}</SessionProvider>;
}
