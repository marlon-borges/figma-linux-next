import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isDev } from "Utils/Common/isDev";
import { isInsideDirs } from "./safePath";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** dist/ — the directory every bundled renderer page (index.html, settings.html…) lives in. */
const APP_PAGES_DIR = resolve(__dirname, "..");

/**
 * Who may call an IPC channel.
 *   - "app":   the app's own pages (panel, Settings, changelog…), loaded from
 *              dist/ or, in dev, from the Vite dev server.
 *   - "figma": the Figma web app (https://figma.com, https://*.figma.com).
 *
 * Figma tabs run with contextIsolation: false, so a page loaded in one shares
 * globals with the preload and must be assumed able to reach ipcRenderer.
 * Those tabs can also leave figma.com (SSO/SAML logins navigate to the
 * identity provider), so the channel decides who it answers, not the tab.
 */
export type IpcSenderPolicy = "app" | "figma";

export function isAppPageUrl(url: string, devServerUrl = process.env.VITE_DEV_SERVER_URL): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol === "file:") {
    try {
      return isInsideDirs(fileURLToPath(parsed), [APP_PAGES_DIR]);
    } catch {
      return false;
    }
  }

  if (isDev && devServerUrl) {
    try {
      return parsed.origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }

  return false;
}

export function isFigmaPageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    parsed.protocol === "https:" &&
    (parsed.hostname === "figma.com" || parsed.hostname.endsWith(".figma.com"))
  );
}

export function isAllowedSenderUrl(url: string, policy: IpcSenderPolicy): boolean {
  return policy === "app" ? isAppPageUrl(url) : isFigmaPageUrl(url);
}

/**
 * URL of the frame that sent an IPC message. senderFrame is null once that
 * frame has navigated away or been destroyed; an unknown sender is refused.
 */
export function ipcSenderUrl(event: { senderFrame?: { url: string } | null }): string {
  try {
    const frame = event.senderFrame;
    if (frame) return frame.url;
  } catch {
    // Accessing a destroyed frame throws on some Electron versions.
  }
  return "";
}
