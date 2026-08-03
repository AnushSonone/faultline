// Embed build only. The normal dev/build path (vite.config.ts) is untouched:
// it declares no postcss config, so nothing here shadows it and vice versa.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import prefixSelector from "postcss-prefix-selector";

const ROOT = "#faultline-demo-root";

export default defineConfig({
  // Relative base so the emitted CSS references fonts relative to its own
  // location (url(assets/...)), wherever the blog hosts the bundle.
  base: "./",
  plugins: [react()],
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  css: {
    postcss: {
      plugins: [
        // Scope every rule under the mount node so the app's styles cannot
        // bleed into the host blog page. @font-face has no selector and
        // @keyframes step selectors are skipped by the plugin.
        prefixSelector({
          prefix: ROOT,
          transform(prefix, selector, prefixedSelector) {
            // embed.css already targets the root; never double-prefix.
            if (selector.startsWith(ROOT)) return selector;
            // Document-level selectors collapse onto the mount node itself.
            if (selector === ":root" || selector === "html" || selector === "body") {
              return prefix;
            }
            // :root[data-theme="light"] -> #faultline-demo-root[data-theme="light"]
            if (selector.startsWith(":root")) return prefix + selector.slice(":root".length);
            // standalone [data-theme="light"] -> #faultline-demo-root[data-theme="light"]
            if (selector.startsWith("[data-theme")) return prefix + selector;
            return prefixedSelector;
          },
        }),
      ],
    },
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    // Not build.lib: Vite library mode force-inlines every asset into the CSS
    // as base64 (assetsInlineLimit is documented as ignored in lib mode), which
    // balloons the stylesheet and defeats font caching. A plain rollup IIFE
    // build produces the same self-contained bundle while emitting fonts as
    // hashed files that the CSS references relatively.
    assetsInlineLimit: 0,
    rollupOptions: {
      input: "src/embed.tsx",
      output: {
        format: "iife",
        name: "FaultlineDemo",
        inlineDynamicImports: true,
        entryFileNames: "faultline-demo.iife.js",
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] ?? "";
          if (name.endsWith(".css")) return "faultline-demo.css";
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
});
