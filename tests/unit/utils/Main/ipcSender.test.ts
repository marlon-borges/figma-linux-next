import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ipcSenderUrl, isAllowedSenderUrl, isFigmaPageUrl } from "Utils/Main/ipcSender";

// ipcSender resolves the app's page directory from its own location
// (src/utils/Main → src/utils), mirroring dist/main → dist in a build.
const APP_PAGES_DIR = resolve(import.meta.dir, "../../../../src/utils");

describe("isFigmaPageUrl", () => {
  it("accepts https figma.com and subdomains", () => {
    expect(isFigmaPageUrl("https://www.figma.com/design/abc/x")).toBe(true);
    expect(isFigmaPageUrl("https://figma.com/files/recent")).toBe(true);
  });

  it("rejects lookalikes, plain http and other schemes", () => {
    expect(isFigmaPageUrl("https://figma.com.evil.com/design/abc")).toBe(false);
    expect(isFigmaPageUrl("https://notfigma.com/")).toBe(false);
    expect(isFigmaPageUrl("http://www.figma.com/")).toBe(false);
    expect(isFigmaPageUrl("file:///home/u/figma.com/index.html")).toBe(false);
    expect(isFigmaPageUrl("")).toBe(false);
  });
});

describe("isAllowedSenderUrl", () => {
  it("'app' accepts the bundled pages and nothing on the web", () => {
    const settingsPage = pathToFileURL(resolve(APP_PAGES_DIR, "settings.html")).href;
    expect(isAllowedSenderUrl(settingsPage, "app")).toBe(true);
    expect(isAllowedSenderUrl("https://www.figma.com/design/abc", "app")).toBe(false);
    expect(isAllowedSenderUrl("https://login.okta.com/", "app")).toBe(false);
  });

  it("'app' rejects a file:// page outside the app (e.g. a dropped local HTML file)", () => {
    expect(isAllowedSenderUrl("file:///home/u/Downloads/evil.html", "app")).toBe(false);
    const outside = pathToFileURL(resolve(APP_PAGES_DIR, "../../evil.html")).href;
    expect(isAllowedSenderUrl(outside, "app")).toBe(false);
  });

  it("'figma' accepts Figma and refuses an SSO page the same tab navigated to", () => {
    expect(isAllowedSenderUrl("https://www.figma.com/design/abc", "figma")).toBe(true);
    expect(isAllowedSenderUrl("https://login.okta.com/app/figma/sso", "figma")).toBe(false);
  });
});

describe("ipcSenderUrl", () => {
  it("reads the sending frame's URL", () => {
    expect(ipcSenderUrl({ senderFrame: { url: "https://www.figma.com/" } })).toBe(
      "https://www.figma.com/",
    );
  });

  it("returns an empty string when the frame is gone, so the sender is refused", () => {
    expect(ipcSenderUrl({ senderFrame: null })).toBe("");
    expect(ipcSenderUrl({})).toBe("");
    expect(isAllowedSenderUrl(ipcSenderUrl({}), "figma")).toBe(false);
  });
});
