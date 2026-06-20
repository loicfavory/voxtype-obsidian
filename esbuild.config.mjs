import esbuild from "esbuild";
import process from "process";

const watch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "codemirror", "@codemirror/*"],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "node",
});

if (watch) {
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
