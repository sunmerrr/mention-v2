import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig(({ isSsrBuild }) => ({
  root: fileURLToPath(new URL("./apps/web", import.meta.url)),
  plugins: [react()],
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true,
    manifest: true,
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: isSsrBuild ? "entry-server.js" : "assets/[hash].js",
        chunkFileNames: "assets/[hash].js",
        assetFileNames: "assets/[hash][extname]",
      },
    },
  },
}));
