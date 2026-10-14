import type { Rectangle } from "electron";

import { NEW_FILE_TAB_TITLE, RECENT_FILES } from "Const";
import { parseURL } from "Utils/Common";
import CommunityTab from "./CommunityTab";
import MainTab from "./MainTab";
import Tab, { allocateLogicalTabId } from "./Tab";

/**
 * A saved tab restored lazily on launch (app.lazyRestoreTabs): it holds a
 * slot in the tab strip — position, group, title — but no webContents until
 * its first focus revives it from `url`. Deliberately NOT a `Tab` with a
 * nulled-out `.view`: `Tab.view` is touched unconditionally (no null checks)
 * by most of Tab.ts/TabManager.ts/Window.ts, so a distinct shape that never
 * claims to have a view means every call site that needs a live view is
 * forced (by the type checker, via the existing `instanceof Tab` pattern
 * already used throughout) to handle "this tab isn't loaded right now"
 * instead of crashing the first time a discarded tab is touched by a path
 * nobody thought to test.
 */
export interface DiscardedTab {
  readonly discarded: true;
  id: number;
  title?: string;
  url: string;
  groupId?: string;
  /** The account the tab runs as (SavedTab.userId); its first load puts it back as `fuid`. */
  userId?: string;
}

export default class TabManager {
  public mainTab: MainTab;
  public communityTab: CommunityTab | undefined;
  public hasOpenedNewFileTab: boolean = false;
  public hasOpenedCommunityTab: boolean = false;

  public lastFocusedTab: number | undefined;
  /**
   * Single map, ordered exactly as the tab strip renders (sortTabs reorders
   * this directly) — live and discarded tabs share one ordering so a
   * discarded tab keeps its position instead of needing a second structure
   * kept in sync with this one.
   */
  private tabs: Map<number, Tab | DiscardedTab> = new Map();
  /** Real webContents id -> logical tab id, for the handful of call sites that only have the raw id an IPC event arrived on (event.sender.id). Only live tabs have an entry. */
  private webContentsIndex: Map<number, number> = new Map();

  public get mainTabWebContentId() {
    return this.mainTab.view.webContents.id;
  }
  public get communityTabWebContentId() {
    return this.communityTab ? this.communityTab.view.webContents.id : undefined;
  }

  constructor(private windowId: number) {
    this.mainTab = new MainTab(this.windowId);
    this.lastFocusedTab = this.mainTab.id;

    this.registerEvents();
  }

  public setUserId(id: string) {
    this.mainTab.setUserId(id);
  }

  public addTab(url = RECENT_FILES, title?: string): Tab {
    const tab = new Tab(this.windowId);

    tab.title = title;
    tab.loadUrl(url);
    this.tabs.set(tab.id, tab);
    this.webContentsIndex.set(tab.webContentsId, tab.id);

    if (title === NEW_FILE_TAB_TITLE) {
      this.hasOpenedNewFileTab = true;
    }

    return tab;
  }

  /** Promote a pre-warmed Tab (already loaded in background) into the active tab list. */
  public promoteWarmTab(tab: Tab): void {
    tab.title = NEW_FILE_TAB_TITLE;
    this.tabs.set(tab.id, tab);
    this.webContentsIndex.set(tab.webContentsId, tab.id);
    this.hasOpenedNewFileTab = true;
  }

  /**
   * Insert a tab directly in the discarded state — no WebContentsView is
   * constructed at all. Used for lazy session restore (see Window.restoreTabs): every saved
   * tab except the one that was actually active last session shows up in the
   * strip immediately, but costs nothing until clicked.
   */
  public addDiscardedShell(saved: Types.SavedTab): DiscardedTab {
    const discarded: DiscardedTab = {
      discarded: true,
      id: allocateLogicalTabId(),
      title: saved.title,
      url: saved.url ?? RECENT_FILES,
      groupId: saved.groupId,
      userId: saved.userId,
    };
    this.tabs.set(discarded.id, discarded);

    if (discarded.title === NEW_FILE_TAB_TITLE) {
      this.hasOpenedNewFileTab = true;
    }

    return discarded;
  }

  /**
   * Resolve a live Tab from the real webContents id an IPC event arrived on
   * (event.sender.id) — never a DiscardedTab, since a discarded tab has no
   * webContents left to send an event. Use this instead of a raw
   * `getAll().get(event.sender.id)` anywhere a handler needs "the tab that
   * just sent me this," since a tab's logical id and its real webContents id
   * are different numbers (see Tab.ts).
   */
  public getByWebContentsId(webContentsId: number): Tab | undefined {
    const logicalId = this.webContentsIndex.get(webContentsId);
    if (logicalId === undefined) return undefined;
    const tab = this.tabs.get(logicalId);
    return tab instanceof Tab ? tab : undefined;
  }

  /**
   * Rebuild the live view for a discarded tab, preserving its logical id
   * (and therefore its position/group) even though the fresh
   * WebContentsView gets a brand-new real webContents id — exactly why tab
   * identity is decoupled from it (see Tab.ts). Attaches nothing and shows
   * nothing; that's Window.setTabFocus's job, mirroring how addTab only
   * attaches hidden and a separate setTabFocus call does the showing.
   */
  public reviveTab(discarded: DiscardedTab): Tab {
    const tab = new Tab(this.windowId);
    tab.id = discarded.id;
    tab.title = discarded.title;
    tab.groupId = discarded.groupId;

    // Every tab owns its account: load under the one the tab was saved with, or the server
    // picks whichever account it treats as default (see Tab.reload). Tab.loadUrl reads the
    // fuid back into tab.userId.
    let url = discarded.url;
    if (discarded.userId) {
      const parsedUrl = parseURL(url);
      if (parsedUrl) {
        parsedUrl.searchParams.set("fuid", discarded.userId);
        url = parsedUrl.toString();
      }
    }
    tab.loadUrl(url);

    this.tabs.set(tab.id, tab);
    this.webContentsIndex.set(tab.webContentsId, tab.id);

    if (tab.title === NEW_FILE_TAB_TITLE) {
      this.hasOpenedNewFileTab = true;
    }

    return tab;
  }

  public addCommunityTab() {
    this.communityTab = new CommunityTab(this.windowId);
  }
  public closeCommunityTab() {
    if (this.communityTab.view.webContents && !this.communityTab.view.webContents.isDestroyed()) {
      this.communityTab.view.webContents.destroy();
    }

    this.communityTab = undefined;
  }
  public handleCallbackForTab(webContentsId: number, callbackID: number, args: unknown) {
    const tab = this.getByWebContentsId(webContentsId);

    if (tab) {
      tab.view.webContents.send("handleCallback", callbackID, args);
    }
  }

  public closeAll() {
    for (const tab of this.tabs.values()) {
      if (tab instanceof Tab && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.destroy();
      }
    }
    this.tabs.clear();
    this.webContentsIndex.clear();

    // mainTab and communityTab live outside the map. Leaving them behind was
    // invisible while every window close ended the process; with the tray
    // keeping the app alive each close would leak a full Figma page.
    if (this.communityTab) this.closeCommunityTab();
    if (!this.mainTab.view.webContents.isDestroyed()) {
      this.mainTab.view.webContents.destroy();
    }
  }
  public close(tabId: number): Types.TabIdType {
    const tab = this.tabs.get(tabId);
    const array = [...this.tabs.entries()];
    let nextTabId: Types.TabIdType;

    if (!tab) {
      this.tabs.delete(tabId);
      return this.hasOpenedCommunityTab ? "communityTab" : "mainTab";
    }

    for (let i = 0; i < array.length; i++) {
      const entry = array[i];
      const next = array[i + 1];

      if (!next) {
        break;
      }
      if (entry[0] === tabId) {
        nextTabId = next[0];
        break;
      }

      nextTabId = entry[0];
    }

    if (tab instanceof Tab) {
      this.webContentsIndex.delete(tab.webContentsId);
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.webContents.destroy();
      }
    }
    if (tab.title === NEW_FILE_TAB_TITLE) {
      this.hasOpenedNewFileTab = false;
    }

    this.tabs.delete(tabId);

    if (!nextTabId) {
      nextTabId = this.hasOpenedCommunityTab ? "communityTab" : "mainTab";
    }

    return nextTabId;
  }

  public reloadAll() {
    this.tabs.forEach((t) => {
      if (t instanceof Tab) t.reload();
    });
  }
  public updateScaleAll(scale: number) {
    this.mainTab.updateScale(scale);
    if (this.communityTab) this.communityTab.updateScale(scale);
    this.tabs.forEach((t) => {
      if (t instanceof Tab) t.updateScale(scale);
    });
  }

  public getNextTabId(currentId: Types.TabIdType | undefined): number | undefined {
    const ids = [...this.tabs.keys()];
    if (ids.length === 0) return undefined;
    const idx = typeof currentId === "number" ? ids.indexOf(currentId) : -1;
    return ids[(idx + 1) % ids.length];
  }

  public getPrevTabId(currentId: Types.TabIdType | undefined): number | undefined {
    const ids = [...this.tabs.keys()];
    if (ids.length === 0) return undefined;
    const idx = typeof currentId === "number" ? ids.indexOf(currentId) : 0;
    return ids[(idx - 1 + ids.length) % ids.length];
  }

  public getTabByIndex(index: number) {
    let i = 0;
    let foundTab: Tab | DiscardedTab | undefined;

    this.tabs.forEach((tab) => {
      if (index === i) {
        foundTab = tab;
      }

      i++;
    });

    return foundTab;
  }

  public getTabIndex(webContentsId: number) {
    // NOTE: `return` inside forEach only skips one iteration — it does not stop
    // the walk — so the counter must break out of a real loop instead.
    let i = 0;
    for (const id of this.tabs.keys()) {
      if (webContentsId === id) return i;
      i++;
    }
    return -1;
  }

  public reloadTab(tabId: number) {
    const tab = this.getById(tabId);

    if (tab instanceof Tab) {
      tab.reload();
    } else if (tab && !("discarded" in tab)) {
      tab.view.webContents.reload();
    }
  }
  public loadUrlInMainTab(url: string) {
    this.mainTab.loadUrl(url);
  }
  public loadUrlInCommunityTab(url: string) {
    this.communityTab.loadUrl(url);
  }
  public loadLoginPage() {
    this.mainTab.loadLoginPage();
  }
  public handleUrl(path: string) {
    this.mainTab.handleUrl(path);
  }
  public getById(id: Types.TabIdType): Tab | DiscardedTab | MainTab | CommunityTab | undefined {
    switch (id) {
      case "mainTab": {
        return this.mainTab;
      }
      case "communityTab": {
        return this.communityTab;
      }
      default: {
        if (this.tabs.has(id as number)) {
          return this.tabs.get(id as number);
        } else if (this.mainTab.id === id) {
          return this.mainTab;
        } else if (this.communityTab && this.communityTab.id === id) {
          return this.communityTab;
        }
      }
    }

    return undefined;
  }
  public getByTitle(title: string) {
    let foundTab: Tab | DiscardedTab | undefined;

    this.tabs.forEach((tab) => {
      if (tab.title === title) {
        foundTab = tab;
      }
    });

    return foundTab;
  }
  public getByPath(path: string) {
    let foundTab: Tab | DiscardedTab | undefined;

    this.tabs.forEach((tab) => {
      const liveUrl = tab instanceof Tab ? (tab.url ?? tab.getUrl()) : tab.url;
      const pathname = parseURL(liveUrl)?.pathname;
      if (!pathname) return;
      // Plain substring match — the pathname is user data, not a pattern.
      if (path.includes(pathname)) {
        foundTab = tab;
      }
    });

    return foundTab;
  }
  public getAll = () => this.tabs;

  /** Direct map lookup — avoids the getById() fallback-to-mainTab footgun for a dynamic id. */
  public setGroupId(tabId: number, groupId: string | undefined) {
    const tab = this.tabs.get(tabId);
    if (tab) tab.groupId = groupId;
  }

  public focusTab(id: Types.TabIdType) {
    const tab = this.getById(id);

    if (tab) {
      this.lastFocusedTab = tab.id;
    }
  }
  public setTitle(id: number, title: string) {
    const tab = this.getById(id);
    if (!tab) return;

    if (tab instanceof Tab) {
      tab.title = title;
    }
  }
  public setBounds(id: number, bounds: Rectangle) {
    const tab = this.getById(id);

    if (tab && !("discarded" in tab)) {
      tab.setBounds(bounds);
    }
  }
  public focusMainTab() {
    this.lastFocusedTab = this.mainTab.id;
  }
  public focusCommunityTab() {
    this.lastFocusedTab = this.communityTab.id;
  }
  public setBoundsForActiveTab(bounds: Rectangle) {
    this.mainTab.setBounds(bounds);
    const active = this.getById(this.lastFocusedTab);
    if (active && active !== this.mainTab && !("discarded" in active)) {
      active.setBounds(bounds);
    }
  }

  public setBoundsForAllTab(bounds: Rectangle) {
    this.mainTab.setBounds(bounds);

    if (this.hasOpenedCommunityTab) {
      this.communityTab.setBounds(bounds);
    }

    for (const [_, tab] of this.tabs) {
      if (!("discarded" in tab)) tab.setBounds(bounds);
    }
  }
  public sortTabs(tabs: Types.TabFront[]) {
    const entries = [...this.tabs.entries()];
    const next = new Map<number, Tab | DiscardedTab>();
    const placed = new Set<number>();

    // Apply the requested order for ids we actually have.
    for (const tab of tabs) {
      const entry = entries.find(([key]) => key === tab.id);
      if (entry && !placed.has(entry[0])) {
        next.set(entry[0], entry[1]);
        placed.add(entry[0]);
      }
    }
    // Preserve any existing tabs the payload didn't mention — never drop a tab.
    for (const [key, tab] of entries) {
      if (!placed.has(key)) {
        next.set(key, tab);
      }
    }

    this.tabs = next;
  }

  public getTabUrl(tabId: number) {
    const tab = this.tabs.get(tabId);
    if (!tab) return undefined;

    return tab instanceof Tab ? tab.view.webContents.getURL() : tab.url;
  }

  public isNewFileTab(tabId: number) {
    for (const [_, tab] of this.tabs) {
      if (tab.title && tab.title === NEW_FILE_TAB_TITLE && tab.id === tabId) {
        return true;
      }
    }

    return false;
  }
  public isMainTab(tabId: number) {
    const keys = [...this.tabs.keys()];

    if (keys[0] === tabId) {
      return true;
    }

    return false;
  }

  public handlePluginMenuAction(pluginMenuAction: Menu.MenuAction) {
    const tab = this.getById(this.lastFocusedTab);

    if (tab && !("discarded" in tab)) {
      tab.view.webContents.send("handlePluginMenuAction", pluginMenuAction);
    }
  }

  public getActiveTabPath(): string {
    const tab = this.getById(this.lastFocusedTab);
    if (!tab || "discarded" in tab) return "";
    const tabUri = tab.view.webContents.getURL();

    return parseURL(tabUri)?.pathname ?? "";
  }

  private registerEvents() {}
}
