import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/watch/watcher-cli.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  shims: true,
});
