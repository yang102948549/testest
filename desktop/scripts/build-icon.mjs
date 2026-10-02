// build/icon.svg -> build/icon.ico (PNG-embedded, 16..256) and build/icon.png, rendered with Edge.
import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";

const svg = await readFile(new URL("../build/icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
});
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = [];
for (const size of sizes) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`,
  );
  pngs.push(await page.screenshot({ omitBackground: true, type: "png" }));
  await page.close();
}
await browser.close();
const head = Buffer.alloc(6 + 16 * sizes.length);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = head.length;
sizes.forEach((s, i) => {
  const o = 6 + 16 * i;
  head[o] = s === 256 ? 0 : s;
  head[o + 1] = s === 256 ? 0 : s;
  head.writeUInt16LE(1, o + 4);
  head.writeUInt16LE(32, o + 6);
  head.writeUInt32LE(pngs[i].length, o + 8);
  head.writeUInt32LE(offset, o + 12);
  offset += pngs[i].length;
});
await writeFile(new URL("../build/icon.ico", import.meta.url), Buffer.concat([head, ...pngs]));
await writeFile(new URL("../build/icon.png", import.meta.url), pngs.at(-1));
console.log("icon built");
