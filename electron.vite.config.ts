import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

/**
 * electron-vite build config. Three independent targets:
 *   - main:     Electron main process  -> out/main/index.js   (CJS)
 *   - preload:  context-isolated bridge -> out/preload/index.js (CJS)
 *   - renderer: the pet widget          -> out/renderer/        (ESM, bundled)
 *
 * `externalizeDepsPlugin` keeps Node/Electron built-ins external for main &
 * preload; the renderer is fully bundled (the old `<script>`-tag globals and
 * the constants UMD wrapper are gone — everything is a normal ESM import).
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
  },
});
