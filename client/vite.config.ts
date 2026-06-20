import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const clientRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  server: {
    port: 5173,
    fs: {
      allow: [".."]
    },
    proxy: {
      "/api": "http://127.0.0.1:8787"
    }
  },
  build: {
    outDir: "../dist/client",
    emptyOutDir: true
  }
});
