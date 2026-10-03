import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/mongo-global.ts"],
    // Arrancar MongoDB y bajar el binario la primera vez puede tardar.
    hookTimeout: 120_000,
  },
});
