import { app } from "electron";
import fs from "node:fs";
import { BASE_DEFAULT_SETTINGS } from "Utils/Common/defaultSettings";

import { logger } from "./Logger";

// Vulkan switches — both trigger Vulkan usage and are incompatible with ozone=wayland.
const VULKAN_SWITCHES = ["use-vulkan", "enable-unsafe-webgpu", "enable-skia-graphite"];

/**
 * True when NVIDIA's proprietary kernel driver is loaded (open or closed kernel module —
 * both ship the same userspace GL/Vulkan driver). nouveau does not create this file.
 */
export function hasNvidiaProprietaryDriver(
  exists: (p: string) => boolean = fs.existsSync,
): boolean {
  return exists("/proc/driver/nvidia/version");
}

/**
 * Whether the settings ask for a mode that only works under X11 ozone: WebGPU shaders, or
 * the Vulkan renderer on an NVIDIA driver (see applyDefaultOptimizations for both).
 */
function wantsX11(settings: Partial<Types.SettingsInterface["app"]>, nvidia: boolean): boolean {
  return Boolean(settings?.enableWebGPU || (vulkanRendererEnabled(settings) && nvidia));
}

// index.ts reads settings.json raw (no defaults merged), so a profile saved before this
// setting existed has no key — it must still get the default.
function vulkanRendererEnabled(settings: Partial<Types.SettingsInterface["app"]>): boolean {
  return settings?.enableVulkanRenderer ?? BASE_DEFAULT_SETTINGS.app.enableVulkanRenderer;
}

/**
 * Undo the environment the XWayland relaunch (index.ts) set up, so `app.relaunch()` starts a
 * process that chooses its session afresh. Without this a restart after turning shaders off
 * kept running under XWayland: the relaunched child inherited the stripped env.
 */
export function restoreOriginalSessionEnv(env: NodeJS.ProcessEnv = process.env) {
  if (!env.FIGMA_FORCE_X11) return;
  if (env.FIGMA_ORIG_WAYLAND_DISPLAY) env.WAYLAND_DISPLAY = env.FIGMA_ORIG_WAYLAND_DISPLAY;
  if (env.FIGMA_ORIG_XDG_SESSION_TYPE) env.XDG_SESSION_TYPE = env.FIGMA_ORIG_XDG_SESSION_TYPE;
  delete env.FIGMA_ORIG_WAYLAND_DISPLAY;
  delete env.FIGMA_ORIG_XDG_SESSION_TYPE;
  delete env.FIGMA_FORCE_X11;
}

/**
 * Decide whether the process must relaunch itself under a clean X11 environment.
 *
 * Figma's WebGPU shader effects and the Vulkan renderer only work under X11 ozone, and
 * Electron reads WAYLAND_DISPLAY during early native init — too early to strip in JS — so a
 * Wayland session wanting either must spawn a fresh child with WAYLAND_DISPLAY removed (see
 * index.ts).
 * Pure + env-injectable so the decision is unit-testable without spawning anything.
 *
 * Guards: FIGMA_FORCE_X11 prevents an infinite relaunch loop; dev is skipped (vite owns the
 * Electron process); test is skipped (Playwright drives the launched process directly, so
 * spawning a detached copy + app.exit(0) would orphan it and hang every e2e test); Flatpak is
 * skipped because re-exec'ing the ~220MB Electron binary as a detached, unref'd child from an
 * about-to-exit parent goes through zypak's spawn interception and segfaults it deterministically
 * (reproduced on AMD, independent of GPU/sandbox/zygote flags and zypak version — the crash is in
 * libzypak-preload-host-spawn-strategy.so, not in anything Chromium/GPU-related). Under Flatpak we
 * just fall through to the existing "shaders requested but Wayland" log below and run without them.
 */
export function shouldRelaunchUnderX11(
  settings: Partial<Types.SettingsInterface["app"]>,
  env: NodeJS.ProcessEnv = process.env,
  nvidia: boolean = hasNvidiaProprietaryDriver(),
): boolean {
  return Boolean(
    wantsX11(settings, nvidia) &&
      env.WAYLAND_DISPLAY &&
      !env.FIGMA_FORCE_X11 &&
      env.NODE_ENV !== "dev" &&
      env.NODE_ENV !== "test" &&
      !env.FLATPAK_ID,
  );
}

/**
 * Apply every Chromium command-line switch.
 *
 * CRITICAL: this MUST run synchronously at process startup, BEFORE the first `await`
 * (i.e. before `app.ready`). Chromium reads the command line once when the GPU/browser
 * process launches on ready; ANY `appendSwitch` after that point is silently ignored —
 * the code path still runs and logs, but the flags never reach the engine. This bit GPU
 * switches hard: they used to be applied inside `new App()` which runs after
 * `await storage.initialize()`, so Skia stayed `GaneshGL`, Wayland/VAAPI flags never took
 * effect, and Figma's WebGPU shader effects (which need Skia Graphite) couldn't render.
 * That is why the same flags work in a standalone probe but not in the app. The caller in
 * `index.ts` reads settings.json synchronously (via fs) and invokes this before `start()`.
 */
export function applyChromiumSwitches(
  settings: Partial<Types.SettingsInterface["app"]> = {},
  nvidia: boolean = hasNvidiaProprietaryDriver(),
) {
  // Chromium flags for better performance and GPU support
  // Full flags reference: https://peter.sh/experiments/chromium-command-line-switches/

  const switches = settings.commandSwitches;

  // Detect session type before applying defaults so we can make informed decisions
  const isWayland = process.env.XDG_SESSION_TYPE === "wayland" || !!process.env.WAYLAND_DISPLAY;

  // "value": "false" / "0" is a UI convention for "disabled" — skip those entirely.
  // Chromium boolean flags have no =false form; you either pass them or you don't.
  const effectiveSwitches = (switches ?? []).filter((s) => s.value !== "false" && s.value !== "0");

  // User explicitly opts into Vulkan only if a vulkan switch is present and not disabled.
  const userForcesVulkan = effectiveSwitches.some((s) => VULKAN_SWITCHES.includes(s.switch));

  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- hoisted helper, kept below for readability
  applyDefaultOptimizations(isWayland, userForcesVulkan, settings, nvidia);

  if (effectiveSwitches.length) {
    for (const item of effectiveSwitches) {
      // Skip Vulkan switches on Wayland unless user explicitly forced them above.
      if (isWayland && !userForcesVulkan && VULKAN_SWITCHES.includes(item.switch)) {
        logger.info(`Wayland: skipping user switch --${item.switch}`);
        continue;
      }
      app.commandLine.appendSwitch(item.switch, item.value);
    }
  }

  if (settings.enableColorSpaceSrgb) {
    app.commandLine.appendSwitch("force-color-profile", "srgb");
  } else {
    app.commandLine.appendSwitch("disable-color-correct-rendering");
  }
}

function applyDefaultOptimizations(
  isWayland: boolean,
  userForcesVulkan: boolean,
  settings: Partial<Types.SettingsInterface["app"]>,
  nvidia: boolean,
) {
  const enableShaders = !!settings.enableWebGPU;
  // Figma's Shader / Halftone / Noise effects need WebGPU output to composite onto the
  // canvas. Chromium's WebGPU↔GL interop (webgpu_on_vk_via_gl_interop) does exactly that,
  // and it is available under X11 ozone but DISABLED under Wayland ozone (crbug 442791440 /
  // 475935650 — the entry is Wayland-specific). So we just run the app under X11/XWayland:
  // the effects then render through the lightweight GaneshGL compositor + interop. We do
  // NOT enable Skia Graphite — Graphite (GraphiteDawnVulkan) also renders the effects but
  // adds noticeable canvas-pan latency; GaneshGL + interop is the faster path.
  //
  // Vulkan renderer (NVIDIA): NVIDIA's OpenGL driver spends a lot of CPU per GL command,
  // and Figma re-renders the whole scene for every frame of a playing video (thousands of
  // passes). On an RTX 3060 Ti that pinned the GPU process main thread at 100% inside
  // libnvidia-eglcore and dropped the canvas to 2–8 fps — Chrome on the same machine does the
  // same. ANGLE on Vulkan (`use-angle=vulkan` + `Vulkan` + `VulkanFromANGLE`; without the
  // last one the GPU process fails to come up) cut that to ~23 fps on the same file. It also
  // gives WebGPU a hardware adapter with the GPU sandbox on — without it Dawn falls back to
  // SwiftShader on NVIDIA. Skia becomes GaneshVulkan; pan frame times measured identical to
  // GaneshGL. Wayland ozone rejects Vulkan surfaces (the window never shows), so this mode
  // needs XWayland too.
  //
  // X11 must be set from a CLEAN X11 environment at process start (Electron reads
  // WAYLAND_DISPLAY during early native init) — index.ts relaunches Wayland sessions with a
  // stripped env first (non-dev). In dev the env can't be relaunched (vite owns the process),
  // so use the env prefix. If the toggle is on but we're still on Wayland, run normally
  // without shaders rather than force ozone=x11 (which would break window creation).
  const shadersActive = enableShaders && !isWayland;
  const vulkanActive = nvidia && wantsX11(settings, nvidia) && !isWayland;
  if (shadersActive || vulkanActive) {
    app.commandLine.appendSwitch("ozone-platform", "x11");
  }
  if (vulkanActive) {
    app.commandLine.appendSwitch("use-angle", "vulkan");
  } else if (nvidia && vulkanRendererEnabled(settings) && isWayland) {
    logger.info(
      "Vulkan renderer requested but session is Wayland — using NVIDIA OpenGL (Flatpak and dev can't relaunch under XWayland)",
    );
  }
  if (!shadersActive && enableShaders) {
    logger.info(
      process.env.FLATPAK_ID
        ? "WebGPU shaders requested but session is Wayland — running without them (not available under Flatpak: relaunching under XWayland crashes zypak's spawn interception, see applyChromiumSwitches.ts)"
        : "WebGPU shaders requested but session is Wayland — running without them (a production build relaunches under XWayland automatically; in dev use `env -u WAYLAND_DISPLAY XDG_SESSION_TYPE=x11 bun run dev`)",
    );
  }

  // On X11: bypass the GPU blocklist so hardware acceleration isn't blocked for
  // capable GPUs. On Wayland: leave the blocklist active — it disables Vulkan for
  // known-incompatible combos (AMD + ozone=wayland), preventing the Dawn/Vulkan
  // surface factory conflict and the associated log spam.
  if (!isWayland) {
    app.commandLine.appendSwitch("ignore-gpu-blocklist");
  }
  app.commandLine.appendSwitch("enable-gpu-rasterization");
  app.commandLine.appendSwitch("enable-zero-copy");

  // Collect all features to enable
  const features = [
    "VaapiVideoDecoder",
    "VaapiVideoEncoder",
    "CanvasOopRasterization",
    "WebRTCPipeWireCapturer",
    "UseSkiaRenderer",
  ];

  // Wayland support detection and enablement
  if (isWayland) {
    logger.info("Wayland session detected - enabling native Wayland support");
    app.commandLine.appendSwitch("ozone-platform-hint", "auto");
    features.push("WaylandWindowDecorations", "UseOzonePlatform");
  } else {
    if (vulkanActive) {
      logger.info("NVIDIA driver — running under XWayland (ozone=x11) with ANGLE on Vulkan");
      features.push("Vulkan", "VulkanFromANGLE");
    } else if (shadersActive) {
      logger.info(
        "WebGPU shaders enabled — running under XWayland (ozone=x11); effects composite via WebGPU↔GL interop on GaneshGL",
      );
    }
    // DirectRenderingDisplayCompositor moves the display compositor onto the GPU
    // process thread, reducing frame-delivery latency. X11-only — incompatible
    // with Wayland's own compositor scheduling.
    features.push("DirectRenderingDisplayCompositor");
  }

  // Enable modern rendering features
  app.commandLine.appendSwitch("enable-features", features.join(","));

  // WebGPU/Vulkan: gated on the enableWebGPU toggle, not merely on the session type.
  // enable-unsafe-webgpu exposes navigator.gpu, which is what Figma probes to switch on
  // its Shader/Halftone/Noise effects — so it belongs with the shaders, behind the toggle.
  // Previously this fired on any X11 session (!isWayland), which left WebGPU silently ON
  // for X11 users who had the toggle OFF, contradicting the setting. Now it follows
  // shadersActive (X11 + enableWebGPU); on Wayland the blocklist disables Vulkan anyway.
  // The escape hatch stays: a user can force it via commandSwitches (userForcesVulkan),
  // which also re-enables it on Wayland with a warning. Note this only gates WebGPU — the
  // normal WebGL canvas keeps its hardware acceleration (ignore-gpu-blocklist + enable-webgl
  // on X11 are untouched), so a toggle-off X11 user simply loses the shader effects, not
  // general GPU rendering.
  if (shadersActive || userForcesVulkan) {
    if (userForcesVulkan && isWayland) {
      logger.warn(
        "enable-unsafe-webgpu forced on Wayland via commandSwitches — Vulkan may conflict with the compositor",
      );
    }
    app.commandLine.appendSwitch("enable-unsafe-webgpu");
  }

  // WebGL optimizations for Figma's canvas engine
  app.commandLine.appendSwitch("enable-webgl");
  app.commandLine.appendSwitch("enable-webgl2-compute-context");
  app.commandLine.appendSwitch("enable-accelerated-2d-canvas");

  // Disable smooth scrolling to let Figma handle it
  app.commandLine.appendSwitch("disable-smooth-scrolling");

  // Performance optimizations
  app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");

  logger.info(
    `Applied default performance optimizations for Linux (session: ${isWayland ? "Wayland" : "X11"}${
      shadersActive ? ", XWayland forced for shaders" : ""
    })`,
  );
}
