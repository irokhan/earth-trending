# Earth Trending

An interactive Vite + React + TypeScript experience that visualizes trending tracks around the globe with a stylized Three.js scene.

## Prerequisites
- Node.js 18 or later
- npm (bundled with Node.js)

## Setup
Install dependencies:
```bash
npm install
```

## Run locally (dev server)
Start Vite's dev server with hot reload:
```bash
npm run dev
```
This prints a local URL (typically `http://localhost:5173`) where you can explore the globe.

## Build for production
Emit optimized static assets to `dist/`:
```bash
npm run build
```

## Preview the production build
Serve the built assets locally for a final verification step:
```bash
npm run preview
```
Make sure you run `npm run build` first so the preview uses the latest output.

## Project structure
- `src/App.tsx` — main Three.js globe experience and UI
- `src/main.tsx` — React entry point
- `src/index.css` — global styles
- `vite.config.ts` — Vite configuration
