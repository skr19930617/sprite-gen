import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER_ORIGIN = process.env.VITE_SERVER_ORIGIN ?? "http://127.0.0.1:8000";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      // Forward API + static asset paths to the FastAPI server. Anything else
      // is served by Vite (HMR).
      "/api": {
        target: SERVER_ORIGIN,
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      "/projects": {
        target: SERVER_ORIGIN,
        changeOrigin: false,
      },
      "/healthz": {
        target: SERVER_ORIGIN,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
