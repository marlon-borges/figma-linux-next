import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

// Self-contained electron mock (other test files override the global preload's electron mock,
// so this test records switches into a local array bound to its own app.commandLine).
const recorded: Array<{ name: string; value?: string }> = [];

mock.module("electron", () => ({
  app: {
    commandLine: {
      appendSwitch: (name: string, value?: string) => {
        recorded.push({ name, value });
      },
      appendArgument: (arg: string) => {
        recorded.push({ name: arg });
      },
    },
  },
}));

// Let the real Logger load against a no-op electron-log (full transports shape so its
// top-level configuration in Main/Logger doesn't throw).
mock.module("electron-log/main", () => ({
  default: {
    initialize: () => {},
    error: () => {},
    warn: () => {},
    info: () => {},
    debug: () => {},
    transports: {
      file: { level: "debug", resolvePathFn: undefined },
      console: { level: "debug" },
    },
  },
}));

import {
  applyChromiumSwitches,
  hasNvidiaProprietaryDriver,
  restoreOriginalSessionEnv,
  shouldRelaunchUnderX11,
} from "Main/applyChromiumSwitches";

const has = (name: string) => recorded.some((s) => s.name === name);
const switchValue = (name: string) => recorded.find((s) => s.name === name)?.value;
const features = (): string[] => {
  const f = recorded.find((s) => s.name === "enable-features");
  return f?.value ? f.value.split(",") : [];
};

// applyChromiumSwitches reads process.env for session detection, so each case sets/clears
// WAYLAND_DISPLAY / XDG_SESSION_TYPE and we restore the real values afterwards.
const ENV_KEYS = ["WAYLAND_DISPLAY", "XDG_SESSION_TYPE"] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  recorded.length = 0;
  savedEnv = {};
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("applyChromiumSwitches — Wayland vs X11 truth-table", () => {
  test("X11, shaders off: blocklist bypass + DirectRenderingDisplayCompositor, WebGPU stays OFF", () => {
    applyChromiumSwitches({}, false);

    expect(has("ignore-gpu-blocklist")).toBe(true);
    // WebGPU is gated on the enableWebGPU toggle, not the session type: toggle off → no unsafe-webgpu.
    expect(has("enable-unsafe-webgpu")).toBe(false);
    expect(features()).not.toContain("Vulkan");
    expect(has("disable-gpu-sandbox")).toBe(false);
    // …but general GPU acceleration for the normal WebGL canvas is unaffected.
    expect(has("enable-webgl")).toBe(true);
    expect(features()).toContain("DirectRenderingDisplayCompositor");
    expect(features()).not.toContain("WaylandWindowDecorations");
    expect(has("ozone-platform")).toBe(false);
    // colorspace defaults off → disable-color-correct-rendering
    expect(has("disable-color-correct-rendering")).toBe(true);
    expect(has("force-color-profile")).toBe(false);
  });

  test("X11 + enableWebGPU: forces ozone-platform=x11 and enables unsafe-webgpu for shaders", () => {
    applyChromiumSwitches({ enableWebGPU: true }, false);

    expect(switchValue("ozone-platform")).toBe("x11");
    expect(has("enable-unsafe-webgpu")).toBe(true);
    expect(has("ignore-gpu-blocklist")).toBe(true);
    expect(features()).toContain("DirectRenderingDisplayCompositor");
    // Non-NVIDIA: shaders keep the GaneshGL + interop path, GPU sandbox stays on.
    expect(features()).not.toContain("Vulkan");
    expect(has("use-angle")).toBe(false);
    expect(has("disable-gpu-sandbox")).toBe(false);
  });

  test("Wayland, shaders off: ozone-hint=auto, Wayland features, no blocklist bypass, no vulkan", () => {
    process.env.WAYLAND_DISPLAY = "wayland-0";

    applyChromiumSwitches({}, false);

    expect(switchValue("ozone-platform-hint")).toBe("auto");
    expect(features()).toContain("WaylandWindowDecorations");
    expect(features()).toContain("UseOzonePlatform");
    expect(features()).not.toContain("DirectRenderingDisplayCompositor");
    expect(has("ignore-gpu-blocklist")).toBe(false);
    expect(has("enable-unsafe-webgpu")).toBe(false);
    expect(has("ozone-platform")).toBe(false);
  });

  test("Wayland + enableWebGPU: does NOT force ozone=x11 (shaders inactive on Wayland)", () => {
    process.env.WAYLAND_DISPLAY = "wayland-0";

    applyChromiumSwitches({ enableWebGPU: true }, false);

    expect(has("ozone-platform")).toBe(false);
    // Shaders are inactive on a live Wayland session (production relaunches under XWayland
    // before this runs), so unsafe-webgpu stays off here too.
    expect(has("enable-unsafe-webgpu")).toBe(false);
    expect(features()).not.toContain("Vulkan");
    expect(has("disable-gpu-sandbox")).toBe(false);
    expect(features()).toContain("WaylandWindowDecorations");
  });

  test("Wayland + user-forced vulkan switch: applies enable-unsafe-webgpu despite Wayland", () => {
    process.env.WAYLAND_DISPLAY = "wayland-0";

    applyChromiumSwitches({ commandSwitches: [{ switch: "enable-unsafe-webgpu" }] }, false);

    expect(has("enable-unsafe-webgpu")).toBe(true);
  });

  test("XDG_SESSION_TYPE=wayland alone (no WAYLAND_DISPLAY) is treated as Wayland", () => {
    process.env.XDG_SESSION_TYPE = "wayland";

    applyChromiumSwitches({}, false);

    expect(features()).toContain("WaylandWindowDecorations");
    expect(has("ignore-gpu-blocklist")).toBe(false);
  });

  test("colorspace sRGB on: force-color-profile=srgb instead of disable-color-correct-rendering", () => {
    applyChromiumSwitches({ enableColorSpaceSrgb: true }, false);

    expect(switchValue("force-color-profile")).toBe("srgb");
    expect(has("disable-color-correct-rendering")).toBe(false);
  });

  test("disabled command switch (value:'false') is filtered out; enabled one is applied", () => {
    applyChromiumSwitches({ commandSwitches: [{ switch: "some-flag", value: "false" }] }, false);
    expect(has("some-flag")).toBe(false);

    recorded.length = 0;
    applyChromiumSwitches({ commandSwitches: [{ switch: "some-flag" }] }, false);
    expect(has("some-flag")).toBe(true);
  });
});

describe("shouldRelaunchUnderX11", () => {
  const webgpu = { enableWebGPU: true };

  test("enableWebGPU off → never relaunch", () => {
    expect(
      shouldRelaunchUnderX11({}, { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "production" }, false),
    ).toBe(false);
  });

  test("WebGPU + Wayland + production → relaunch", () => {
    expect(
      shouldRelaunchUnderX11(
        webgpu,
        { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "production" },
        false,
      ),
    ).toBe(true);
  });

  test("FIGMA_FORCE_X11 set → no relaunch (infinite-loop guard)", () => {
    expect(
      shouldRelaunchUnderX11(
        webgpu,
        {
          WAYLAND_DISPLAY: "wayland-0",
          FIGMA_FORCE_X11: "1",
          NODE_ENV: "production",
        },
        false,
      ),
    ).toBe(false);
  });

  test("NODE_ENV=dev → no relaunch", () => {
    expect(
      shouldRelaunchUnderX11(webgpu, { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "dev" }, false),
    ).toBe(false);
  });

  test("NODE_ENV=test → no relaunch (regression: orphaned Playwright process)", () => {
    expect(
      shouldRelaunchUnderX11(webgpu, { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "test" }, false),
    ).toBe(false);
  });

  test("no WAYLAND_DISPLAY (X11 session) → no relaunch", () => {
    expect(shouldRelaunchUnderX11(webgpu, { NODE_ENV: "production" }, false)).toBe(false);
  });

  test("FLATPAK_ID set → no relaunch (regression: zypak spawn interception segfaults)", () => {
    expect(
      shouldRelaunchUnderX11(
        webgpu,
        {
          WAYLAND_DISPLAY: "wayland-0",
          NODE_ENV: "production",
          FLATPAK_ID: "app.borys.FigmaLinuxNext",
        },
        false,
      ),
    ).toBe(false);
  });
});

describe("NVIDIA Vulkan renderer", () => {
  test("NVIDIA + enableVulkanRenderer on X11: XWayland + ANGLE on Vulkan, sandbox kept", () => {
    applyChromiumSwitches({ enableVulkanRenderer: true }, true);

    expect(switchValue("ozone-platform")).toBe("x11");
    expect(switchValue("use-angle")).toBe("vulkan");
    // Without VulkanFromANGLE the GPU process fails to start; without Vulkan WebGPU is SwiftShader.
    expect(features()).toContain("Vulkan");
    expect(features()).toContain("VulkanFromANGLE");
    expect(has("disable-gpu-sandbox")).toBe(false);
    // The renderer alone does not expose WebGPU — that stays behind the shaders toggle.
    expect(has("enable-unsafe-webgpu")).toBe(false);
  });

  test("settings.json saved before the toggle existed (key missing) → default on", () => {
    // Regression: index.ts passes the raw file, so `undefined` must mean the default.
    expect(
      shouldRelaunchUnderX11({}, { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "production" }, true),
    ).toBe(true);

    applyChromiumSwitches({}, true);
    expect(switchValue("use-angle")).toBe("vulkan");
  });

  test("NVIDIA + shaders (renderer toggle off): still uses ANGLE on Vulkan for a hardware adapter", () => {
    applyChromiumSwitches({ enableWebGPU: true, enableVulkanRenderer: false }, true);

    expect(switchValue("use-angle")).toBe("vulkan");
    expect(features()).toContain("VulkanFromANGLE");
    expect(has("enable-unsafe-webgpu")).toBe(true);
  });

  test("NVIDIA with the toggle off: plain X11 OpenGL path", () => {
    applyChromiumSwitches({ enableVulkanRenderer: false }, true);

    expect(has("ozone-platform")).toBe(false);
    expect(has("use-angle")).toBe(false);
    expect(features()).not.toContain("Vulkan");
  });

  test("non-NVIDIA GPU: the toggle has no effect", () => {
    applyChromiumSwitches({ enableVulkanRenderer: true }, false);

    expect(has("ozone-platform")).toBe(false);
    expect(has("use-angle")).toBe(false);
    expect(features()).not.toContain("Vulkan");
  });

  test("NVIDIA on a live Wayland session (Flatpak/dev): no Vulkan — Wayland ozone rejects it", () => {
    process.env.WAYLAND_DISPLAY = "wayland-0";

    applyChromiumSwitches({ enableVulkanRenderer: true }, true);

    expect(has("use-angle")).toBe(false);
    expect(has("ozone-platform")).toBe(false);
    expect(features()).not.toContain("Vulkan");
    expect(features()).toContain("WaylandWindowDecorations");
  });

  test("relaunch under X11 for the Vulkan renderer only on NVIDIA", () => {
    const env = { WAYLAND_DISPLAY: "wayland-0", NODE_ENV: "production" };
    expect(shouldRelaunchUnderX11({ enableVulkanRenderer: true }, env, true)).toBe(true);
    expect(shouldRelaunchUnderX11({ enableVulkanRenderer: true }, env, false)).toBe(false);
    expect(shouldRelaunchUnderX11({ enableVulkanRenderer: false }, env, true)).toBe(false);
  });

  test("hasNvidiaProprietaryDriver checks /proc/driver/nvidia/version", () => {
    expect(hasNvidiaProprietaryDriver((p) => p === "/proc/driver/nvidia/version")).toBe(true);
    expect(hasNvidiaProprietaryDriver(() => false)).toBe(false);
  });
});

describe("restoreOriginalSessionEnv", () => {
  test("restores the Wayland env saved by the XWayland relaunch (restart returns to Wayland)", () => {
    const env: NodeJS.ProcessEnv = {
      XDG_SESSION_TYPE: "x11",
      FIGMA_FORCE_X11: "1",
      FIGMA_ORIG_WAYLAND_DISPLAY: "wayland-0",
      FIGMA_ORIG_XDG_SESSION_TYPE: "wayland",
    };

    restoreOriginalSessionEnv(env);

    expect(env).toEqual({ WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" });
  });

  test("no-op when the process was not relaunched under X11", () => {
    const env: NodeJS.ProcessEnv = { WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" };

    restoreOriginalSessionEnv(env);

    expect(env).toEqual({ WAYLAND_DISPLAY: "wayland-0", XDG_SESSION_TYPE: "wayland" });
  });
});
