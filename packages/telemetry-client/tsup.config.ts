import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/auto.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  // No Node.js shims - this is for browser/RN environments
  platform: "neutral",
  // Ensure it works in both browser and React Native
  target: "es2020",
});
