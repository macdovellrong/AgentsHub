import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { createDevServerWatchOptions } from "./src/shared/dev-watch";

const projectRoot = process.cwd();
const rendererRoot = path.join(projectRoot, "src/renderer");
const devServerWatch = createDevServerWatchOptions();
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: rendererRoot,
    server: {
      watch: devServerWatch,
    },
    build: {
      rollupOptions: {
        input: {
          index: path.join(rendererRoot, "index.html"),
        },
      },
    },
    plugins: [react()],
  },
});
