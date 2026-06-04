// Color themes. Green is the default. Built-in themes plus user-defined ones
// from ~/.config/catunes/themes.json (name -> { accent, spectrum }).

import { existsSync, readFileSync } from "node:fs";
import { THEMES_FILE, loadSettings, saveSettings } from "./config.ts";

export interface Theme {
  accent: string; // main UI color (borders, markers, labels)
  spectrum: [string, string, string]; // visualizer: low, mid, high
}

const DEFAULT_THEME = "Green";

const BUILTIN: Record<string, Theme> = {
  Green: { accent: "green", spectrum: ["green", "yellow", "red"] },
  Amber: { accent: "yellow", spectrum: ["yellow", "red", "magenta"] },
  Cyan: { accent: "cyan", spectrum: ["cyan", "blue", "magenta"] },
  Magenta: { accent: "magenta", spectrum: ["magenta", "blue", "cyan"] },
  Mono: { accent: "white", spectrum: ["gray", "white", "white"] },
};

let cached: Theme | null = null;

function customThemes(): Record<string, Theme> {
  if (!existsSync(THEMES_FILE)) return {};
  try {
    return JSON.parse(readFileSync(THEMES_FILE, "utf8"));
  } catch {
    return {};
  }
}

/** All theme names (built-in first, then custom). */
export function listThemes(): string[] {
  return [...Object.keys(BUILTIN), ...Object.keys(customThemes())];
}

export function activeThemeName(): string {
  return loadSettings().theme ?? DEFAULT_THEME;
}

export function setTheme(name: string): void {
  saveSettings({ theme: name });
  cached = null;
}

/** The resolved active theme (custom overrides built-in; falls back to Green). */
export function theme(): Theme {
  if (cached) return cached;
  const name = activeThemeName();
  cached = customThemes()[name] ?? BUILTIN[name] ?? BUILTIN[DEFAULT_THEME]!;
  return cached;
}

/** Replaces the {a} accent token with the theme color (for i18n strings). */
export function themed(str: string): string {
  return str.replaceAll("{a}", `{${theme().accent}-fg}`);
}
