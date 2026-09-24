import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const app = "../../webapp/src/app";

test("the social image is the exact approved 1200x630 PNG within crawler limits", () => {
  const png = readFileSync(app + "/opengraph-image.png");
  const provenance = JSON.parse(readFileSync("../../webapp/assets/social-preview.json", "utf8"));
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 5_000_000);
  assert.equal(createHash("sha256").update(png).digest("hex"), provenance.sha256);
  assert.deepEqual(provenance.copy, {
    title: "REACTOR TV",
    subtitle: "infinite AI video livestream",
  });
});

test("sharing uses the static card, descriptive alt text and large Twitter preview", () => {
  assert.equal(existsSync(app + "/opengraph-image.tsx"), false);
  const alt = readFileSync(app + "/opengraph-image.alt.txt", "utf8").trim();
  assert.match(alt, /^REACTOR TV\. infinite AI video livestream\./);
  assert.match(alt, /curved television screen/);
  const layout = readFileSync(app + "/layout.tsx", "utf8");
  assert.match(layout, /twitter: \{ card: "summary_large_image" \}/);
  assert.match(layout, /openGraph: \{\s*type: "website"/);
  assert.match(layout, /description: "Infinite AI video livestream\."/);
});
