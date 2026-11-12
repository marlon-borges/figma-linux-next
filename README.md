# <img src="resources/icons/128x128.png" width="32"> Figma Linux Next

Native app based on [Electron](http://electron.atom.io)-based browser wrapper for the [Figma](https://figma.com) web app on Linux.
Loads figma.com directly — no private APIs, no data scraping, no account sharing.
Not affiliated with or endorsed by Figma, Inc.

> **About this fork.** This repository is based on
> [arximus88/figma-linux-next](https://github.com/arximus88/figma-linux-next) (itself descended
> from [Figma-Linux/figma-linux](https://github.com/Figma-Linux/figma-linux)) and keeps its
> GPL-2.0 license. Credit for the app goes to its original authors and contributors; their
> commit history lives in the original repository. This fork starts at v0.22.2 with security
> hardening (see the [CHANGELOG](CHANGELOG.md)). Issue, PR and discussion numbers in the
> CHANGELOG refer to the original repository.

<p>
  <a href="https://github.com/marlon-borges/figma-linux-next/releases"><img alt="Release" src="https://img.shields.io/github/v/release/marlon-borges/figma-linux-next?style=flat-square&logo=github"></a>
  <a href="https://github.com/marlon-borges/figma-linux-next/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/marlon-borges/figma-linux-next/total?style=flat-square&color=success"></a>
  <a href="https://github.com/marlon-borges/figma-linux-next/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/marlon-borges/figma-linux-next/ci.yml?branch=staging&style=flat-square&label=CI&logo=githubactions&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/marlon-borges/figma-linux-next?style=flat-square"></a>
</p>
<p>
  <a href="https://github.com/marlon-borges/figma-linux-next/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/marlon-borges/figma-linux-next?style=flat-square&logo=github"></a>
  <a href="https://github.com/marlon-borges/figma-linux-next/issues"><img alt="Issues" src="https://img.shields.io/github/issues/marlon-borges/figma-linux-next?style=flat-square"></a>
  <a href="https://github.com/marlon-borges/figma-linux-next/commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/marlon-borges/figma-linux-next?style=flat-square"></a>
</p>
<p>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-47848F?style=flat-square&logo=electron&logoColor=white">
  <img alt="Svelte" src="https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white">
  <img alt="Vite" src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&logo=vite&logoColor=white">
  <img alt="Bun" src="https://img.shields.io/badge/Bun-000000?style=flat-square&logo=bun&logoColor=white">
  <img alt="Biome" src="https://img.shields.io/badge/Biome-60A5FA?style=flat-square&logo=biome&logoColor=white">
</p>

> **🧪 Status: Active Testing**
> Pre-built binaries (`.pacman`, `.deb`, `.rpm`, `.AppImage`) for x64 and arm64:
> **https://github.com/marlon-borges/figma-linux-next/releases**

## Features

- **Local system fonts** — full fontconfig (`fc-list`) enumeration plus fontkit for variable-font axes; variable fonts and all named instances work, just like the official desktop app (the web app can't reach them).
- **Shader, Halftone & Noise effects** — Figma's new WebGPU canvas effects render, matching the official app (opt-in, Experimental). On NVIDIA-only systems with driver 535.183.01 or newer they keep native Wayland. Other systems use the X11/XWayland workaround where supported, trading native Wayland features (fractional scaling, per-monitor DPI) for shaders while enabled.
- **Local plugin development** — import a plugin from its `manifest.json` and iterate locally with hot-reload.
- **Figma links open in the app** — the app answers the local-helper check figma.com makes from a browser, so **Open in desktop app** and the **Open links in desktop app** preference work on Linux like they do on Mac and Windows. See [Opening links from your browser](#opening-links-from-your-browser).
- **Built-in MCP server for AI assistants** — a live [Model Context Protocol](https://modelcontextprotocol.io) server (`127.0.0.1:3845`) that speaks the same tool calls as Figma's remote MCP, so Claude Code, Cursor and other clients can read and edit your open design without a plugin. Read-only by default; write tools, Figma AI tools and a Chrome DevTools control plane are separate switches in Settings. See [AI integration (MCP)](#ai-integration-mcp).
- **Latest Chromium engine** — Electron 45 / Chromium 156, so the canvas, WebGL and color handling track the current web app.
- **Up-to-date Google Fonts** — Google Sans, Google Sans Flex, Google Sans Code and other recent additions are available.
- **Runs on both Wayland and X11** — native Wayland on GNOME, KDE Plasma, Sway, Hyprland, with a clean X11 fallback. Tested on Asahi Linux (Apple Silicon), Niri, and openSUSE.
- **Native window frame styles** — GNOME (Adwaita), KDE Plasma (Breeze) and Legacy Windows (Figma's own Windows chrome) frames, picked automatically from your desktop environment (Plasma → Breeze, GNOME → Adwaita, anything else → Legacy) with a manual override in Settings (macOS TBD). The frame follows Figma's Light/Dark/System theme, the minimize/maximize buttons can be hidden for a stock-GNOME look, and the new-tab `+` can sit after the last tab (as in Figma's own desktop app) instead of the left corner. Resting the pointer on a tab shows a card with its title, Figma's thumbnail of the file and when it was last edited (off switch in Settings).
- **Instant new-file tab** — pre-loaded in the background after login, opens with no delay.
- **Trackpad tuned for Linux** — pan and pinch-zoom speeds are adjustable (Figma tunes both for a Mac
  trackpad), and an experimental momentum mode keeps the canvas gliding after you lift your fingers.
- **Sessions that come back as you left them** — files reopen on the page and viewport you were on,
  each under the account it was opened with; optional lazy restore loads only your most recent tabs
  at startup and the rest when you click them.
- **System tray** — opt-in in Settings: Figma stays in the tray when the last window closes; "Show Figma" brings it back (restoring a minimised window), with New Window, Settings and Quit alongside. Native on KDE Plasma, needs the AppIndicator extension on GNOME.
- **Config isolation** — uses `~/.config/figma-linux-next`, no conflicts with legacy installations.

## Opening links from your browser

On Mac and Windows, Figma in a browser offers **Open in desktop app** and an **Open links in desktop
app** preference. It does not use `figma://` for that: the page probes a small local helper the
official app installs at `127.0.0.1:44950` and, when it answers, hands the file link over. The page's
own platform check already includes Linux, so figma-linux-next answers that probe (off by default, turn on in
**Settings → Integrations → Open links from your browser**).

If you use [figma-agent-linux](https://github.com/neetly/figma-agent-linux) for local fonts on
figma.com, keep this off: both listen on the same port, and whichever starts first takes it.

To use it, open any file on figma.com in Chrome or Firefox and pick **Main menu → Preferences →
Open links in desktop app**; **Open in desktop app** in the same menu does it once. Chrome 142 and
newer first ask to allow *local network access* for figma.com — the link that triggers that prompt
stays in the browser, the next one opens here. The same account must be signed in here. Only requests from figma.com are answered and only figma.com links are opened; the port is the
one Figma's page looks for and cannot change. A `figma://` link still opens the app directly.

## AI integration (MCP)

figma-linux-next ships a built-in [Model Context Protocol](https://modelcontextprotocol.io) server so
assistants like Claude Code can work with your **live** design — no plugin to install, no cloud
round-trip. Everything binds to `127.0.0.1` and is configured in **Settings → Integrations**.

- **Context that fits your agent.** `get_design_context` answers in markup with CSS: tokens by name
  (`var(--color-text, #14191f)`), text styles and component docs defined once, repeated instances
  written out once. A 54-layer screen takes 10k characters where raw JSON took 95k. Pass
  `clientFrameworks: "react"` and it answers with a React + Tailwind component instead, like
  Figma's remote server.
- **Speaks Figma's remote MCP.** `use_figma` runs Plugin API code as one undo step, every file tool
  takes a `fileKey` or a pasted link and runs in that file's tab, plus `get_metadata`,
  `get_screenshot`, `get_motion_context`, `get_variable_defs`, `search_design_system`, `download_assets` /
  `upload_assets`, `get_comments` and `get_versions`.
- **Stays out of your way.** A file named by `fileKey` does not have to be the tab in front, or
  even loaded: tools read it, screenshot it and edit it in the background, and never raise the
  window or switch your tab.
- **Your whole design system in reach.** Search every team and community library you can use, list
  libraries and their published styles, see library updates the file has not accepted, read Code
  Connect snippets.
- **Figma's AI, from your own assistant** (experimental, off by default, spends your AI credits).
  Claude or Cursor can hand a task to Figma's built-in agent and check what it changed, generate and
  edit images (saved to disk and placed in the file), and check your credit balance.
- **Control plane — Chrome DevTools (CDP)** (opt-in, needs a restart). Exposes the app window over
  `--remote-debugging-port` so a CDP client (e.g.
  [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)) can drive the UI —
  switch tabs, click, type, screenshot the real window.

Reading is on out of the box. Write tools, Figma AI tools and window control are separate opt-in
switches, and Settings lists every tool with the description your assistant reads. Web pages open in
your browser cannot reach the server: requests carrying a non-loopback `Origin` are refused.

The data plane reads files through Figma's own Plugin API (`window.figma`), which Figma exposes only
when you can **edit** the file: not with a Dev or View seat, not in files shared with you as
"can view" (Dev Mode included), not in Sites files, and not where your organization has turned
plugins off. When a tool can't read a file it says which of these applies. For files you can only
view, use [Figma's remote MCP server](https://help.figma.com/hc/en-us/articles/32132100833559),
which works with view access.

## Tech Stack

- **Electron 45** (Chromium 156)
- **Svelte 5** with runes
- **Vite 8**
- **Bun**
- **Biome** (lint + format)

## Installation

Download from **https://github.com/marlon-borges/figma-linux-next/releases**:

```bash
# Arch / CachyOS (x64)
sudo pacman -U figma-linux-next_*_linux_x64.pacman

# Debian / Ubuntu (x64 or arm64)
sudo dpkg -i figma-linux-next_*_amd64.deb
# or
sudo dpkg -i figma-linux-next_*_arm64.deb

# Fedora / openSUSE
sudo rpm -i figma-linux-next_*_x86_64.rpm

# AppImage
chmod +x figma-linux-next_*.AppImage && ./figma-linux-next_*.AppImage
```

> **AppImage note:** On first launch the app automatically registers the `figma://` URL handler required for login. If login still fails after first launch, register it manually:
>
> ```bash
> # Run once to register the handler
> ~/.local/share/applications/figma-linux-next-appimage.desktop  # created on first launch
> xdg-mime default figma-linux-next-appimage.desktop x-scheme-handler/figma
> update-desktop-database ~/.local/share/applications/
> ```

### Flatpak

> **Not published by this fork yet.** Until its own signed repository is set up, use the
> `.flatpak` bundle from the Releases page (it does not update itself).

One click: open **https://marlon-borges.github.io/figma-linux-next/** and use the install button
(GNOME Software and KDE Discover handle `.flatpakref` files directly). Or from the terminal:

```bash
flatpak install --user https://marlon-borges.github.io/figma-linux-next/figma-linux-next.flatpakref
```

This adds the project's own signed Flatpak repository, so later releases arrive through
`flatpak update` and the software centre like any other Flatpak. The standalone `.flatpak`
bundle on the Releases page still works but does not update itself.

### AUR (Arch / CachyOS)

> The AUR packages are maintained by the original project and build *its* releases, not this
> fork's. For this fork use the `.pacman` file from the Releases page.

```bash
yay -S figma-linux-next
```

Or with any other AUR helper. Package: [figma-linux-next](https://aur.archlinux.org/packages/figma-linux-next)

### NixOS

> **Not published by this fork yet.** The flake resolves release binaries from this repository,
> which become available once the Nix release job is enabled here.

The `--extra-experimental-features` part is only needed until flakes are enabled in your
config (`nix.settings.experimental-features = [ "nix-command" "flakes" ];`).

**Install for your user**, no system config, no rebuild:
```bash
nix profile add --extra-experimental-features "nix-command flakes" github:marlon-borges/figma-linux-next
xdg-mime default figma-linux-next.desktop x-scheme-handler/figma
```
The second line is what makes "Log in with browser" come back to the app. Log in from Firefox
or a Chromium-based browser: GNOME Web (Epiphany) does not hand `figma://` links over to the
app. Update later with
`nix profile upgrade figma-linux-next` (older Nix: `install` instead of `add`).

**Declarative (NixOS module):** add the flake input and enable the program:
```nix
inputs.figma-linux-next.url = "github:marlon-borges/figma-linux-next";

# in your nixosConfiguration
imports = [ figma-linux-next.nixosModules.default ];
programs.figma-linux-next.enable = true;
```
The module installs the package and registers the `figma://` handler for you. Without the
`imports` line `programs.figma-linux-next` is not a known option and evaluation fails.

The flake ships the prebuilt release binaries (x86_64 and aarch64) and is pinned to a specific
version, which CI updates after each release. Pin it yourself by pointing at a tag:
`github:marlon-borges/figma-linux-next/v0.20.1`.

## Migration from legacy figma-linux

Settings are stored in `~/.config/figma-linux-next`. To carry over settings from the old installation:

```bash
cp ~/.config/figma-linux/settings.json ~/.config/figma-linux-next/
```

## Building from source

```bash
git clone https://github.com/marlon-borges/figma-linux-next.git
cd figma-linux-next
bun install
bun run dev      # dev mode with HMR
bun run build    # production build
bun run start    # run production build
bun run pack     # build all packages
```

## Issues & Discussions

- https://github.com/marlon-borges/figma-linux-next/issues
- https://github.com/marlon-borges/figma-linux-next/discussions

## License

GPL-2.0-only — see [LICENSE](LICENSE).
