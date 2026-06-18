import { defineConfig } from "tsdown";

export default defineConfig({
  target: "node18",
  outDir: "dist",
  entry: ["src/main.ts"],
  format: ["esm", "cjs"],
  clean: true,
  dts: true,
  deps: {
    neverBundle: [/\.node$/],
  },
});
