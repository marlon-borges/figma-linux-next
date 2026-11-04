/**
 * Every Figma page announces its account as it boots, project tabs included.
 * Only the home screen's announcement may change the current account: if a tab
 * still running as account A could, reloading it would drag the home screen
 * from B back to A.
 */

import { beforeEach, describe, expect, mock, test } from "bun:test";

const settings: { userId?: string; authedUserIDs?: string[] } = {};

mock.module("Main/Storage", () => ({
  storage: { settings, save: async () => {} },
}));

const { default: AuthController } = await import("Main/controllers/AuthController");

const HOME_TAB = 1;
const PROJECT_TAB = 2;

describe("AuthController: which page decides the current account", () => {
  let window: { setUserId: any; recordProjectTabUser: any };
  let windowManager: { setUserIdOnAllWindows: any; getWindowByWebContentsId: any };
  let controller: any;

  const from = (id: number) => ({ sender: { id } });

  beforeEach(() => {
    settings.userId = "home-account";
    window = {
      setUserId: mock(),
      recordProjectTabUser: mock((id: number) => id === PROJECT_TAB),
    };
    windowManager = {
      setUserIdOnAllWindows: mock(),
      getWindowByWebContentsId: mock(() => window),
    };
    // Skips the constructor, which registers on the process-wide sealed IPC registry.
    controller = Object.create(AuthController.prototype);
    controller.windowManager = windowManager;
  });

  test("setUser from the home tab switches the current account", () => {
    controller.setUser(from(HOME_TAB), "other-account");

    expect(settings.userId).toBe("other-account");
    expect(windowManager.setUserIdOnAllWindows).toHaveBeenCalledWith("other-account");
  });

  test("setUser from a project tab is recorded on that tab and changes nothing else", () => {
    controller.setUser(from(PROJECT_TAB), "other-account");

    expect(window.recordProjectTabUser).toHaveBeenCalledWith(PROJECT_TAB, "other-account");
    expect(settings.userId).toBe("home-account");
    expect(windowManager.setUserIdOnAllWindows).not.toHaveBeenCalled();
  });

  test("setUser with an empty id is ignored", () => {
    controller.setUser(from(HOME_TAB), "");

    expect(settings.userId).toBe("home-account");
    expect(windowManager.setUserIdOnAllWindows).not.toHaveBeenCalled();
  });

  test("setInitialOptions from a project tab does not change the current account", () => {
    controller.setInitialOptions(from(PROJECT_TAB), { userId: "other-account" });

    expect(settings.userId).toBe("home-account");
    expect(window.setUserId).not.toHaveBeenCalled();
  });

  test("setInitialOptions from the home tab sets the current account", () => {
    controller.setInitialOptions(from(HOME_TAB), { userId: "other-account" });

    expect(settings.userId).toBe("other-account");
    expect(window.setUserId).toHaveBeenCalledWith("other-account");
  });
});
