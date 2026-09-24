import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { announcementTickerLayout, ANNOUNCEMENT_PIXELS_PER_SECOND } from "../../../webapp/src/lib/announcement-ticker";

test("announcement speed stays constant and repeats cover a full loop at every width", () => {
  for (const viewport of [320, 390, 820, 1280, 1920, 3440, 5120]) {
    for (const item of [65, 580, 2100]) {
      const layout = announcementTickerLayout(viewport, item)!;
      assert.ok((layout.copies - 1) * item >= viewport, "No empty tail when a whole copy leaves the viewport");
      assert.equal(layout.distance / layout.duration, ANNOUNCEMENT_PIXELS_PER_SECOND);
      assert.equal(layout.distance, item, "Loop advances exactly one repeated unit");
    }
  }
  for (const invalid of [0, -1, NaN, Infinity]) {
    assert.equal(announcementTickerLayout(invalid, 100), null);
    assert.equal(announcementTickerLayout(100, invalid), null);
  }
});

test("announcement renders one accessible message, an explicit pause control and no empty bar", async () => {
  const require = createRequire(resolve("../../webapp/package.json"));
  const { createElement } = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const entry = resolve("../../webapp/src/app/stream/site-banner.tsx");
  const built = await build({ entryPoints: [entry], bundle: true, write: false, platform: "node", format: "cjs", packages: "external", jsx: "automatic", alias: { "@": resolve("../../webapp/src") } });
  const module = { exports: {} as { default: unknown } };
  new Function("require", "module", "exports", built.outputFiles[0].text)(require, module, module.exports);
  const html = renderToStaticMarkup(createElement(module.exports.default, { text: "A new show starts soon" }));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /class="site-banner-track" aria-hidden="true"/);
  assert.match(html, /aria-label="Pause announcement"/);
  assert.match(html, /aria-pressed="false"/);
  assert.equal(renderToStaticMarkup(createElement(module.exports.default, { text: "  " })), "");
  const source = readFileSync(entry, "utf8");
  assert.match(source, /ResizeObserver\(measure\)/);
  assert.match(source, /document.fonts.ready.then\(measure\)/);
  assert.match(source, /observer.disconnect\(\)/);
  assert.doesNotMatch(source, /requestAnimationFrame|setInterval/);
  const css = readFileSync(resolve("../../webapp/src/app/globals.css"), "utf8");
  assert.match(css, /\.site-banner \{[^}]*font-size: 14px;[^}]*font-weight: 400;/);
  assert.match(css, /\.site-banner-item \{[^}]*gap: 28px;[^}]*padding-right: 28px;/);
  assert.match(css, /\.site-banner\[data-paused\] \.site-banner-track/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.site-banner-track \{ animation: none; \}/);
  assert.match(css, /\.site-banner-viewport \{ overflow-x: auto; scrollbar-width: none; \}/);
});
