# Bimbleboard

Bimbleboard is an infinite-canvas whiteboard desktop app for sketching ideas,
diagramming, and freeform note-taking. It's built with [Tauri](https://tauri.app/),
[React](https://react.dev/), and TypeScript, and runs as a lightweight native
application on Windows, macOS, and Linux.

Boards are stored locally as plain JSON files, so your work stays on your machine
and survives browser/webview storage clears.

## Features

- **Infinite canvas** with smooth pan and zoom.
- **Drawing tools:** freehand pen (pressure-aware), rectangle, ellipse, line, and arrow.
- **Post-it notes** with editable text, alignment, and adjustable font sizes.
- **Images:** paste from the clipboard or drag-and-drop onto the canvas.
- **Containers:** drop elements inside shapes/notes and move them together.
- **Selection, move, resize, and z-ordering** of elements.
- **Undo/redo** history.
- **Multiple boards** with autosave.
- **Local-first storage:** one JSON file per board under the app data directory
  (IndexedDB is used when running as a plain web app).
- **Keyboard shortcuts** for every tool.

## Tech stack

- **UI:** React 19 + TypeScript, rendered to an HTML canvas.
- **Styling:** Tailwind CSS and Radix UI primitives.
- **Desktop shell:** Tauri 2 (Rust).
- **Build tooling:** Vite, pnpm, Oxlint.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Rust](https://www.rust-lang.org/tools/install) (stable) and the
  [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

### Install

```bash
pnpm install
```

### Develop

Run the desktop app in development mode with hot reload:

```bash
pnpm tauri:dev
```

Or run just the web frontend:

```bash
pnpm dev
```

### Build

Produce a production desktop bundle and installer for your platform:

```bash
pnpm tauri:build
```

Installers and executables are written to `src-tauri/target/release/bundle/`.

## Releases

Tagged releases are built automatically by GitHub Actions. Pushing a tag of the
form `vX.Y.Z` builds the app for Windows, macOS, and Linux and publishes the
installers to a GitHub Release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The app version is derived from the git tag at build time.

## License

Released under the [MIT License](LICENSE.md).
