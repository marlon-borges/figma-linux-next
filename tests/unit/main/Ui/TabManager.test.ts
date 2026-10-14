import { describe, expect, it, beforeEach, mock, spyOn } from "bun:test";

mock.module("electron", () => {
  let counter = 1;
  class MockWebContentsView {
    webContents = {
      id: counter++,
      on: () => {},
      once: () => {},
      send: () => {},
      loadURL: () => {},
      isDestroyed: () => false,
      getURL: () => "mock-url",
      executeJavaScript: () => Promise.resolve(),
      destroy: () => {},
      reload: () => {},
      setWindowOpenHandler: () => {},
      session: {
        setPermissionRequestHandler: () => {},
        webRequest: {
          onHeadersReceived: () => {},
        },
      },
    };
    setBackgroundColor() {}
    setBounds() {}
    setVisible() {}
    getVisible() {
      return true;
    }
  }

  return {
    app: {
      getPath: () => "/tmp/figma-linux-test",
      getVersion: () => "0.0.0",
      getName: () => "figma-linux-next-test",
      on: () => {},
      emit: () => {},
      quit: () => {},
    },
    net: { request: () => ({}) },
    session: { defaultSession: { webRequest: { onHeadersReceived: () => {} } } },
    protocol: { registerSchemesAsPrivileged: () => {} },
    ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
    BrowserWindow: { fromId: (_id: number): undefined => undefined },
    WebContentsView: MockWebContentsView,
    BrowserView: MockWebContentsView,
    clipboard: {},
    dialog: {},
    Menu: class {},
    MenuItem: class {},
    Tray: class {},
    globalShortcut: {},
    screen: {},
    nativeImage: {},
    nativeTheme: {},
    systemPreferences: {},
    crashReporter: {},
    powerMonitor: {},
    powerSaveBlocker: {},
    desktopCapturer: {},
    MessageChannelMain: class {},
    Notification: class {},
    ShareMenu: class {},
    TouchBar: class {},
    process: {},
    autoUpdater: {},
    contentTracing: {},
    inAppPurchase: {},
    safeStorage: {},
    Rectangle: {},
  };
});

mock.module("Main/Storage", () => ({
  storage: {
    settings: {
      app: {
        figmaTheme: "light",
      },
    },
    save: () => {},
  },
}));

import TabManager from "Main/Ui/TabManager";
import MainTab from "Main/Ui/MainTab";
import CommunityTab from "Main/Ui/CommunityTab";
import Tab from "Main/Ui/Tab";

describe("TabManager", () => {
  let tabManager: TabManager;

  beforeEach(() => {
    tabManager = new TabManager(1);
  });

  describe("lazily restored shells", () => {
    const saved = (url: string, title: string, groupId?: string): Types.SavedTab => ({
      url,
      title,
      groupId,
    });

    it("hold their slot without a webContents", () => {
      const shell = tabManager.addDiscardedShell(
        saved("https://www.figma.com/design/a", "A", "group-a"),
      );
      expect(shell.discarded).toBe(true);
      expect(shell.title).toBe("A");
      expect(shell.groupId).toBe("group-a");
      expect(tabManager.getAll().get(shell.id)).toBe(shell);
      expect(tabManager.getTabUrl(shell.id)).toBe("https://www.figma.com/design/a");
      expect(tabManager.getByPath("/design/a")).toBe(shell);
    });

    it("revive in place: same id, title, group and order, routable by webContents id", () => {
      const a = tabManager.addTab("https://www.figma.com/design/a", "A");
      const shell = tabManager.addDiscardedShell(
        saved("https://www.figma.com/design/b", "B", "group-b"),
      );
      const c = tabManager.addTab("https://www.figma.com/design/c", "C");

      const revived = tabManager.reviveTab(shell);

      expect(revived.id).toBe(shell.id);
      expect(revived.title).toBe("B");
      expect(revived.groupId).toBe("group-b");
      expect(revived.url).toBe("https://www.figma.com/design/b");
      expect(tabManager.getAll().get(shell.id)).toBe(revived);
      expect([...tabManager.getAll().keys()]).toEqual([a.id, shell.id, c.id]);
      expect(revived.webContentsId).not.toBe(revived.id);
      expect(tabManager.getByWebContentsId(revived.webContentsId)).toBe(revived);
    });

    it("revive under the account the tab was saved with", () => {
      const shell = tabManager.addDiscardedShell({
        ...saved("https://www.figma.com/design/a", "A"),
        userId: "user-2",
      });
      expect(shell.userId).toBe("user-2");

      const revived = tabManager.reviveTab(shell);
      expect(new URL(revived.url!).searchParams.get("fuid")).toBe("user-2");
    });

    it("close without touching a webContents", () => {
      const a = tabManager.addTab("https://www.figma.com/design/a", "A");
      const shell = tabManager.addDiscardedShell(saved("https://www.figma.com/design/b", "B"));
      tabManager.close(shell.id);
      expect(tabManager.getAll().has(shell.id)).toBe(false);
      expect(tabManager.getAll().has(a.id)).toBe(true);
    });

    it("are skipped by bulk operations that need a live view", () => {
      tabManager.addDiscardedShell(saved("https://www.figma.com/design/a", "A"));
      expect(() => {
        tabManager.reloadAll();
        tabManager.setBoundsForAllTab({ x: 0, y: 0, width: 100, height: 100 });
        tabManager.closeAll();
      }).not.toThrow();
    });
  });

  describe("getById", () => {
    it("should return mainTab for id 'mainTab'", () => {
      const tab = tabManager.getById("mainTab");
      expect(tab).toBeInstanceOf(MainTab);
      expect(tab).toBe(tabManager.mainTab as any);
    });

    it("should return communityTab for id 'communityTab'", () => {
      tabManager.addCommunityTab();
      const tab = tabManager.getById("communityTab");
      expect(tab).toBeInstanceOf(CommunityTab);
      expect(tab).toBe(tabManager.communityTab as any);
    });

    it("should return communityTab if it exists and matches id", () => {
      tabManager.addCommunityTab();
      const tab = tabManager.getById(tabManager.communityTab.id);
      expect(tab).toBeInstanceOf(CommunityTab);
      expect(tab).toBe(tabManager.communityTab as any);
    });

    it("should return mainTab if id matches mainTab.id", () => {
      const tab = tabManager.getById(tabManager.mainTab.id);
      expect(tab).toBeInstanceOf(MainTab);
      expect(tab).toBe(tabManager.mainTab as any);
    });

    it("should return added tab by its id", () => {
      const newTab = tabManager.addTab("https://test.com", "Test");
      const tab = tabManager.getById(newTab.id);
      expect(tab).toBeInstanceOf(Tab);
      expect(tab).toBe(newTab);
    });

    it("should return undefined for unknown IDs instead of silently falling back to mainTab", () => {
      const tab = tabManager.getById(99999);
      expect(tab).toBeUndefined();
    });
  });

  describe("a tab's account", () => {
    it("takes the account from the fuid of the URL it loads", () => {
      const tab = tabManager.addTab("https://www.figma.com/design/abc/A?fuid=user-1", "A");

      expect(tab.userId).toBe("user-1");
    });

    it("keeps the account when a later URL carries no fuid", () => {
      const tab = tabManager.addTab("https://www.figma.com/design/abc/A?fuid=user-1", "A");

      tab.loadUrl("https://www.figma.com/design/abc/A");

      expect(tab.userId).toBe("user-1");
    });

    it("ignores an empty fuid", () => {
      const tab = tabManager.addTab("https://www.figma.com/design/abc/A?fuid=user-1", "A");

      tab.loadUrl("https://www.figma.com/?fuid=");

      expect(tab.userId).toBe("user-1");
    });
  });

  describe("reloadTab", () => {
    const FILE_URL = "https://www.figma.com/design/abc/A";

    function openAs(userId: string) {
      const tab = tabManager.addTab(`${FILE_URL}?fuid=${userId}`, "A");
      return {
        tab,
        loadUrl: spyOn(tab, "loadUrl"),
        reload: spyOn(tab.view.webContents, "reload"),
      };
    }

    it("puts the tab's own fuid back when Figma has dropped it from the URL", () => {
      const { tab, loadUrl, reload } = openAs("user-1");
      spyOn(tab.view.webContents, "getURL").mockReturnValue(FILE_URL);

      tabManager.reloadTab(tab.id);

      expect(loadUrl).toHaveBeenCalledWith(`${FILE_URL}?fuid=user-1`);
      expect(reload).not.toHaveBeenCalled();
    });

    it("does a plain reload when the URL already carries the tab's fuid", () => {
      const { tab, loadUrl, reload } = openAs("user-1");
      spyOn(tab.view.webContents, "getURL").mockReturnValue(`${FILE_URL}?fuid=user-1`);

      tabManager.reloadTab(tab.id);

      expect(reload).toHaveBeenCalled();
      expect(loadUrl).not.toHaveBeenCalled();
    });

    it("does a plain reload on a page that is not Figma's, so a failed load can retry", () => {
      const { tab, loadUrl, reload } = openAs("user-1");
      spyOn(tab.view.webContents, "getURL").mockReturnValue("chrome-error://chromewebdata/");

      tabManager.reloadTab(tab.id);

      expect(reload).toHaveBeenCalled();
      expect(loadUrl).not.toHaveBeenCalled();
    });

    it("repaints a visible tab once the page has loaded", () => {
      const { tab } = openAs("user-1");
      spyOn(tab.view.webContents, "getURL").mockReturnValue(FILE_URL);
      let finishLoad: (() => void) | undefined;
      spyOn(tab.view.webContents, "once").mockImplementation(((event: string, cb: () => void) => {
        if (event === "did-finish-load") finishLoad = cb;
      }) as any);
      const setVisible = spyOn(tab.view, "setVisible");

      tabManager.reloadTab(tab.id);
      expect(setVisible).not.toHaveBeenCalled();
      finishLoad?.();

      expect(setVisible.mock.calls).toEqual([[false], [true]]);
    });

    it("does not reveal a tab that went to the background while it loaded", () => {
      const { tab } = openAs("user-1");
      spyOn(tab.view.webContents, "getURL").mockReturnValue(FILE_URL);
      let finishLoad: (() => void) | undefined;
      spyOn(tab.view.webContents, "once").mockImplementation(((event: string, cb: () => void) => {
        if (event === "did-finish-load") finishLoad = cb;
      }) as any);
      spyOn(tab.view, "getVisible").mockReturnValue(false);
      const setVisible = spyOn(tab.view, "setVisible");

      tabManager.reloadTab(tab.id);
      finishLoad?.();

      expect(setVisible).not.toHaveBeenCalled();
    });
  });
});
