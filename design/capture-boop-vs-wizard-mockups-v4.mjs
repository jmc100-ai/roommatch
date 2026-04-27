import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = path.join(__dirname, "boop-vs-wizard-mockups-v4.html");
const png = path.join(__dirname, "boop-vs-wizard-mockups-v4.png");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1720, height: 1100 }, deviceScaleFactor: 2 });
await page.goto("file:///" + html.replace(/\\/g, "/"), { waitUntil: "networkidle" });
await page.waitForTimeout(2600);
await page.screenshot({ path: png, fullPage: true });
await browser.close();

console.log("Saved " + png);
