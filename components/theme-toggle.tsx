"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

import { THEME_STORAGE_KEY } from "@/lib/theme";

type Theme = "light" | "dark";

const LIGHT_QUERY = "(prefers-color-scheme: light)";

// Thème affiché : le choix posé sur <html data-theme>, sinon celui du système.
function readTheme(): Theme {
  const value = document.documentElement.dataset.theme;
  if (value === "light" || value === "dark") return value;
  return window.matchMedia(LIGHT_QUERY).matches ? "light" : "dark";
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Sans choix mémorisé, un changement de thème Windows doit mettre l'icône à jour.
  const media = window.matchMedia(LIGHT_QUERY);
  media.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener("change", listener);
  };
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Stockage indisponible (navigation privée) : le choix vaut pour cette page seulement.
  }
  listeners.forEach((listener) => listener());
}

/** Bascule clair / sombre. Avant le premier clic, on suit le réglage du système. */
export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "dark" as const);
  const next: Theme = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Passer en thème clair" : "Passer en thème sombre";

  return (
    <button className="icon-action" onClick={() => applyTheme(next)} aria-label={label} title={label}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );
}
