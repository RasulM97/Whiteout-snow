import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import gameBuildOutput from "./scripts/build-output"

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), gameBuildOutput()],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // Keep the large, rarely changing engines in separate cacheable downloads.
    // The WebGL/physics engines are legitimately larger than UI chunks.
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/")) return "engine-three";
          if (id.includes("node_modules/@dimforge/rapier3d-compat/")) return "engine-physics";
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/") || id.includes("node_modules/scheduler/")) return "shell-react";
          if (id.includes("node_modules/camera-controls/") || id.includes("node_modules/pathfinding/")) return "robot-navigation";
        },
      },
    },
  },
});
