import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    cors: true,
  },
  build: {
    outDir: "../../dist/client",
    emptyOutDir: true
  }
});
