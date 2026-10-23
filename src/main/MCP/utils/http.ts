/**
 * http.ts — Low-level HTTP response helpers for the MCP server.
 *
 * Pure functions extracted from McpServer.ts (Phase 4 of decomposition);
 * no behavior change.
 */

import type http from "node:http";

/**
 * Returns the minimum CORS headers required for MCP local transport.
 * See: https://spec.modelcontextprotocol.io/specification/2025-03-26/basic/transports/
 */
export function cors(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Mcp-Session-Id",
    "Access-Control-Expose-Headers": "Mcp-Session-Id",
  };
}

export function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...cors(),
  });
  res.end(body);
}

/**
 * Sends a JSON-RPC 2.0 error response.
 * See: https://www.jsonrpc.org/specification#error_object
 */
export function replyError(
  res: http.ServerResponse,
  httpCode: number,
  rpcCode: number,
  msg: string,
  reqId: string | number | null = null,
): void {
  sendJson(res, httpCode, {
    jsonrpc: "2.0",
    error: { code: rpcCode, message: msg },
    id: reqId,
  });
}

/**
 * Collects the full request body as a UTF-8 string.
 * Uses for-await-of on the native readable stream.
 */
export async function collectBody(req: http.IncomingMessage): Promise<string> {
  const parts: string[] = [];
  req.setEncoding("utf8");
  for await (const chunk of req) {
    parts.push(chunk as string);
  }
  return parts.join("");
}

/**
 * Validates the Origin header. MCP clients (Claude Code, Cursor, VS Code…) are
 * not browsers and send none; a browser always sends one on a cross-origin
 * fetch/EventSource. The Host check alone does not stop an ordinary website
 * from calling http://127.0.0.1:3845 — the Host it sends is valid — so any
 * page open in the user's browser could read the open design. The MCP
 * transport spec requires servers to validate Origin for exactly this reason.
 *
 * Allowed: no Origin at all, or a loopback http(s) origin (a local tool such
 * as the MCP Inspector). Everything else — including the opaque "null" origin
 * of sandboxed iframes and file:// pages — is refused.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return isValidHost(parsed.host);
}

/** Validates the Host header allows only loopback addresses. */
export function isValidHost(hostHeader: string): boolean {
  let hostname: string;
  try {
    // URL constructor reliably parses host:port combinations
    const parsed = new URL(`http://${hostHeader}`);
    hostname = parsed.hostname;
  } catch {
    return false;
  }

  // Allow only loopback addresses. URL.hostname keeps the brackets for IPv6,
  // so the loopback comes through as "[::1]".
  return (
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname === "localhost"
  );
}
