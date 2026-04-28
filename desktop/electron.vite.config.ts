import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const projectRoot = process.cwd();
const rendererRoot = path.join(projectRoot, "src/renderer");
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    root: rendererRoot,
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
