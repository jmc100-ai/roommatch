import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 980 } });

const htmlPath = path.join(__dirname, "boop-screen6-dealbreakers-list-preview.html");
const outPath = path.join(__dirname, "boop-screen6-dealbreakers-list-preview.png");

await page.goto("file:///" + htmlPath.replace(/\\/g, "/"), { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
await page.screenshot({ path: outPath, fullPage: true });

await browser.close();
console.log("Saved", outPath);
