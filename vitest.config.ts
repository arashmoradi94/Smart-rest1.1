import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", sequence: { concurrent: false }, fileParallelism: false },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
});
