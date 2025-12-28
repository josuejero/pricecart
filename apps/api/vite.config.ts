import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vitest runs Vite in "test" mode and sets VITEST in the config process env.
  const isVitest = !!process.env.VITEST || mode === "test";

  return {
    plugins: isVitest ? [react()] : [react(), cloudflare()],
  };
});
