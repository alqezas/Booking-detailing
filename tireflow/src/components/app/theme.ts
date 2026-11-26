"use client";
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
const isDark = () => document.documentElement.classList.contains("dark");

export function toggleTheme() {
  const next = !isDark();
  document.documentElement.classList.toggle("dark", next);
  try { localStorage.setItem("tf-theme", next ? "dark" : "light"); } catch {}
  listeners.forEach((l) => l());
}

export function useIsDark() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    isDark,
    () => false,
  );
}
