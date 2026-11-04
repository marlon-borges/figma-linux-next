import { expect, test } from "@playwright/test";
import { findPanelPage, openTab, shownView, stripTabs } from "./helpers/app";
import { type AppHandle, closeApp, launchApp } from "./helpers/launch";

/**
 * Each project tab keeps the account it was opened with. Switching accounts on
 * the home screen must not reload it; in real life that reload lands on Figma's
 * "request access" page when the new account has no access to the file.
 *
 * The stub page never runs Figma's code, so `setUser` is emitted on the main
 * process with the page as its sender: the same message, from the same sender.
 */

const FILE = "https://www.figma.com/design/AAA111aaa/project-alpha";
const ACCOUNTS = { userId: "account-a", app: { saveLastOpenedTabs: true } };

/**
 * Serve every https request from a stub, from the very start. launchApp's route
 * arrives after the home tab has already asked the real figma.com, which sends a
 * signed-out profile to /login and drops the fuid these tests read.
 */
const OFFLINE = `
  const { app, session } = require("electron");
  app.whenReady().then(() => {
    session.defaultSession.protocol.handle("https", () =>
      new Response("<!doctype html><title>stub</title>", {
        headers: { "content-type": "text/html" },
      }),
    );
  });
`;

type App = AppHandle["app"];

/** Run code in the page whose URL contains `part`. */
function inPage<T>(app: App, part: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [urlPart, js]) => {
      const page = webContents.getAllWebContents().find((wc) => wc.getURL().includes(urlPart));
      if (!page) throw new Error(`no page with ${urlPart}`);
      return page.executeJavaScript(js);
    },
    [part, code],
  );
}

/** What Figma's `setUser` turns into at the app's door, sent by the page at `part`. */
const announce = (app: App, part: string, account: string) =>
  app.evaluate(
    ({ ipcMain, webContents }, [urlPart, id]) => {
      const sender = webContents.getAllWebContents().find((wc) => wc.getURL().includes(urlPart));
      if (!sender) throw new Error(`no page with ${urlPart}`);
      ipcMain.emit("setUser", { sender }, id);
    },
    [part, account],
  );

const HOME = "/files/recent";

const homeUrl = (app: App) =>
  app.evaluate(
    ({ webContents }, home) =>
      webContents
        .getAllWebContents()
        .map((wc) => wc.getURL())
        .find((url) => url.includes(home)),
    HOME,
  );

/** Open FILE as account-a, then switch the home screen to account-b. */
async function openThenSwitchHome(handle: AppHandle) {
  // The home page announces its account as it boots, as Figma's does.
  await expect.poll(() => homeUrl(handle.app)).toContain("fuid=account-a");
  await announce(handle.app, HOME, "account-a");

  await openTab(handle.app, FILE);
  await expect.poll(() => shownView(handle.app)).toContain("fuid=account-a");
  await inPage(handle.app, "AAA111aaa", "window.__sameDocument = true; 0");

  await announce(handle.app, HOME, "account-b");
  await expect.poll(() => homeUrl(handle.app)).toContain("fuid=account-b");
}

test.describe("Each tab keeps its account", () => {
  test("switching on the home screen does not reload a project tab", async () => {
    const handle = await launchApp({ settings: ACCOUNTS, mainHook: OFFLINE });
    const panel = await findPanelPage(handle.app);

    await openThenSwitchHome(handle);

    // Away to the home screen and back: focusing the tab is when it used to reload.
    await handle.app.evaluate(({ app }) => app.emit("openFileBrowser"));
    await expect.poll(() => shownView(handle.app)).toContain(HOME);
    const [tab] = await stripTabs(panel);
    await panel.evaluate((id) => window.figmaApi.send("setTabFocus", id), tab.id);
    await expect.poll(() => shownView(handle.app)).toContain("AAA111aaa");
    await handle.panel.waitForTimeout(500); // the old reload ran right after focusing

    expect(await shownView(handle.app)).toContain("fuid=account-a");
    expect(await inPage(handle.app, "AAA111aaa", "window.__sameDocument === true")).toBe(true);

    await closeApp(handle);
  });

  test("a project tab announcing its account does not move the home screen", async () => {
    const handle = await launchApp({ settings: ACCOUNTS, mainHook: OFFLINE });

    await openThenSwitchHome(handle);
    await announce(handle.app, "AAA111aaa", "account-a");
    await handle.panel.waitForTimeout(500);

    expect(await homeUrl(handle.app)).toContain("fuid=account-b");

    await closeApp(handle);
  });

  test("reloading a tab puts back the account Figma dropped from its URL", async () => {
    const handle = await launchApp({ settings: ACCOUNTS, mainHook: OFFLINE });
    const panel = await findPanelPage(handle.app);

    await openThenSwitchHome(handle);
    // Figma cleans `fuid` out of the address once a file has loaded.
    await inPage(handle.app, "AAA111aaa", 'history.replaceState(null, "", location.pathname); 0');
    const [tab] = await stripTabs(panel);

    await handle.app.evaluate(({ app }, id) => app.emit("reloadTab", id), tab.id);

    await expect
      .poll(() =>
        handle.app.evaluate(({ webContents }, id) => webContents.fromId(id)?.getURL(), tab.id),
      )
      .toContain("fuid=account-a");

    await closeApp(handle);
  });

  test("a restart brings a tab back under its own account", async () => {
    const first = await launchApp({ settings: ACCOUNTS, mainHook: OFFLINE });

    await openThenSwitchHome(first);
    await closeApp(first);

    const second = await launchApp({ userDataDir: first.userDataDir, mainHook: OFFLINE });
    const fileUrl = () =>
      second.app.evaluate(({ webContents }) =>
        webContents
          .getAllWebContents()
          .map((wc) => wc.getURL())
          .find((url) => url.includes("AAA111aaa")),
      );

    await expect.poll(fileUrl, { timeout: 10_000 }).toContain("fuid=account-a");
    expect(await homeUrl(second.app)).toContain("fuid=account-b");

    await closeApp(second);
  });
});
