import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  // Vitest runs Vite in "test" mode and sets VITEST in the config process env.
  const isVitest = !!process.env.VITEST || mode === "test";
  const plugins = [react()];

  if (!isVitest) {
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(cloudflare());
  }

  return { plugins };
});
