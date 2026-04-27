# Google Cloud — Street View browser key HTTP referrers

Use these **Application restrictions → HTTP referrers (web sites)** entries for the **browser** API key (`GOOGLE_STREETVIEW_BROWSER_KEY`) used in signed Street View image URLs loaded by the client.

Paste each line as its own referrer restriction in the Google Cloud Console (Maps Platform credentials).

| Referrer pattern | Notes |
|------------------|--------|
| `https://www.travelboop.com/*` | Production |
| `https://travelboop.com/*` | Apex |
| `https://roommatch-1fg5.onrender.com/*` | Render production host |
| `https://*.onrender.com/*` | Render preview deploys |
| `http://localhost:*/*` | Local dev |
| `http://127.0.0.1:*/*` | Local loopback |
| `http://192.168.68.*/*` | LAN testing (class C tail per product decision) |

**Server key** (`GOOGLE_STREETVIEW_SERVER_KEY`): restrict by **IP** if you have stable egress, or use a separate key with **API restriction** to Street View Static + Metadata only and **no** HTTP referrer (used only from Node on Render).

**Signing:** Same project **URL signing secret** → `GOOGLE_STREETVIEW_SIGNING_SECRET` on the server. See [Street View digital signature](https://developers.google.com/maps/documentation/streetview/digital-signature).

**Env summary**

| Variable | Role |
|----------|------|
| `GOOGLE_STREETVIEW_SERVER_KEY` | Metadata requests from `server.js` |
| `GOOGLE_STREETVIEW_BROWSER_KEY` | `key=` in image URLs returned to the browser |
| `GOOGLE_STREETVIEW_SIGNING_SECRET` | HMAC-SHA1 signing (required for production hygiene) |
| `GOOGLE_STREETVIEW_KEY` | Legacy: if set, used for **both** server and browser when split keys are absent |
