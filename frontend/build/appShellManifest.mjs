import { createHash } from "node:crypto";

export function buildShellManifest(bundle) {
  const hash = createHash("sha256");
  for (const [name, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(name).update("\0");
    hash.update(output.type === "chunk" ? output.code : output.source).update("\0");
  }
  return {
    revision: hash.digest("hex").slice(0, 20),
    assets: Object.keys(bundle).filter((name) => name.startsWith("assets/") && /\.(js|css)$/.test(name))
      .sort().map((name) => "/" + name),
  };
}

export function appShellManifestPlugin() {
  return {
    name: "hypersync-offline-build-inventory",
    enforce: "post",
    transformIndexHtml() {
      return [{ tag: "meta", attrs: { name: "hypersync-build", content: "__HYPERSYNC_BUILD_REVISION__" }, injectTo: "head" }];
    },
    generateBundle(_options, bundle) {
      const manifest = buildShellManifest(bundle);
      const worker = bundle["sw.js"];
      const html = bundle["index.html"];
      if (!worker?.code?.includes("globalThis.__HYPERSYNC_BUILD_MANIFEST__")
          || !String(html?.source).includes("__HYPERSYNC_BUILD_REVISION__")) {
        throw new Error("Offline build inventory injection is incomplete.");
      }
      worker.code = worker.code.replaceAll("globalThis.__HYPERSYNC_BUILD_MANIFEST__", JSON.stringify(manifest));
      html.source = String(html.source).replaceAll("__HYPERSYNC_BUILD_REVISION__", manifest.revision);
      this.emitFile({ type: "asset", fileName: "app-shell-manifest.json", source: JSON.stringify(manifest) });
    },
  };
}
