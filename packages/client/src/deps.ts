// Detection of external dependencies (mpv, yt-dlp).
// The catunes core needs mpv to play; yt-dlp is optional
// (only for sources like YouTube). Here we locate them and, if missing,
// give the user the exact installation command for their system.

import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { t } from "./i18n.ts";

export interface DepStatus {
  name: string;
  found: boolean;
  path?: string;
  version?: string;
}

/** Checks whether a binary exists in the PATH and returns its version. */
function probe(bin: string, versionArg = "--version"): DepStatus {
  const which = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  if (which.status !== 0) return { name: bin, found: false };

  const path = which.stdout.split(/\r?\n/)[0]?.trim();
  const ver = spawnSync(bin, [versionArg], { encoding: "utf8" });
  const version = ver.stdout?.split(/\r?\n/)[0]?.trim();
  return { name: bin, found: true, path, version };
}

export function checkMpv(): DepStatus {
  return probe("mpv");
}

export function checkYtDlp(): DepStatus {
  return probe("yt-dlp");
}

/** Installation instructions depending on the operating system. */
export function installHint(dep: "mpv" | "yt-dlp"): string {
  const os = platform();
  const hints: Record<string, Record<string, string>> = {
    mpv: {
      darwin: "brew install mpv",
      linux: "sudo apt install mpv   (o: sudo dnf install mpv / sudo pacman -S mpv)",
      win32: "winget install mpv   (o: choco install mpv)",
    },
    "yt-dlp": {
      darwin: "brew install yt-dlp",
      linux: "sudo apt install yt-dlp   (o: pipx install yt-dlp)",
      win32: "winget install yt-dlp   (o: choco install yt-dlp)",
    },
  };
  return hints[dep]?.[os] ?? t("deps.installFallback", { dep });
}
