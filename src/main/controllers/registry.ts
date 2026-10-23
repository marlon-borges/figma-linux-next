/**
 * IPC Registry — centralized registration of all main-process IPC handlers.
 *
 * Benefits:
 * - Single source of truth for channel → handler mapping
 * - Easy to audit which channels exist
 * - Prevents duplicate handler registration
 * - Type-safe handler signatures
 */
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { logger } from "../Logger";
import { ipcSenderUrl, isAllowedSenderUrl, type IpcSenderPolicy } from "Utils/Main/ipcSender";

type IpcOnHandler = (event: IpcMainEvent, ...args: any[]) => void;
type IpcHandleHandler = (event: IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any;

interface RegisteredChannel {
  channel: string;
  type: "on" | "handle";
  source: string;
}

class IpcRegistry {
  private registered: RegisteredChannel[] = [];
  private sealed = false;

  /**
   * Register a fire-and-forget channel (ipcMain.on).
   * With `allow`, messages from any other sender are dropped (see IpcSenderPolicy).
   */
  on(channel: string, handler: IpcOnHandler, source: string, allow?: IpcSenderPolicy) {
    this.assertNotSealed(channel);
    this.assertNotDuplicate(channel);
    ipcMain.on(
      channel,
      allow
        ? (event, ...args) => {
            if (this.isAllowed(channel, event, allow)) handler(event, ...args);
          }
        : handler,
    );
    this.registered.push({ channel, type: "on", source });
  }

  /**
   * Register a request/response channel (ipcMain.handle).
   * With `allow`, calls from any other sender are rejected (see IpcSenderPolicy).
   */
  handle(channel: string, handler: IpcHandleHandler, source: string, allow?: IpcSenderPolicy) {
    this.assertNotSealed(channel);
    this.assertNotDuplicate(channel);
    ipcMain.handle(
      channel,
      allow
        ? (event, ...args) => {
            if (!this.isAllowed(channel, event, allow)) {
              throw new Error(`IPC channel "${channel}" is not available to this page`);
            }
            return handler(event, ...args);
          }
        : handler,
    );
    this.registered.push({ channel, type: "handle", source });
  }

  /**
   * Seal the registry — no more registrations allowed after this.
   * Call after all modules have registered their handlers.
   */
  seal() {
    this.sealed = true;
    logger.info(`[IpcRegistry] Sealed with ${this.registered.length} channels:`);
    for (const entry of this.registered) {
      logger.info(`  [${entry.type}] ${entry.channel} (${entry.source})`);
    }
  }

  /**
   * Get a summary of all registered channels (useful for debugging)
   */
  getSummary() {
    return this.registered.map((r) => `${r.type}:${r.channel} (${r.source})`);
  }

  private isAllowed(
    channel: string,
    event: IpcMainEvent | IpcMainInvokeEvent,
    allow: IpcSenderPolicy,
  ): boolean {
    const url = ipcSenderUrl(event);
    if (isAllowedSenderUrl(url, allow)) return true;
    logger.warn(`[IpcRegistry] Refused "${channel}" from ${url || "an unknown frame"}`);
    return false;
  }

  private assertNotSealed(channel: string) {
    if (this.sealed) {
      throw new Error(`[IpcRegistry] Cannot register "${channel}" — registry is sealed`);
    }
  }

  private assertNotDuplicate(channel: string) {
    if (this.registered.some((r) => r.channel === channel)) {
      throw new Error(`[IpcRegistry] Duplicate registration for channel "${channel}"`);
    }
  }
}

export const ipcRegistry = new IpcRegistry();
