import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(__dirname, "boop-screen5-tiles-preview.html");
const png = path.join(__dirname, "boop-screen5-tiles-preview.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 980 } });
await page.goto("file:///" + html.replace(/\\/g, "/"), { waitUntil: "networkidle" });
await page.waitForTimeout(1800);
await page.screenshot({ path: png, fullPage: true });
await browser.close();

console.log("Saved boop-screen5-tiles-preview.png");
