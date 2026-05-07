/**
 * scripts/email/send-emails.js
 * ---------------------------------------------------------------------------
 * Resend-backed beta email sender. One file, three flows so the templates and
 * sending logic stay in one place. Run with:
 *
 *   node scripts/email/send-emails.js invite   --csv invitees.csv [--dry]
 *   node scripts/email/send-emails.js welcome  --csv invitees.csv [--dry]
 *   node scripts/email/send-emails.js nudge    --csv invitees.csv [--dry]
 *   node scripts/email/send-emails.js call     --csv invitees.csv [--dry]
 *
 * CSV columns (header required): email,first_name
 *
 * Env required: RESEND_API_KEY, BETA_PASSWORD (the gate password to share),
 *               BETA_FROM (default beta@travelboop.com), BETA_REPLY_TO (default
 *               same), BETA_CALENDAR_URL (optional, e.g. https://cal.com/jmc).
 *
 * Free Resend tier = 100 emails/day, 3000/month — perfect for 50 invitees.
 *
 * Idempotency: also marks beta_invitees.{invite,welcome,nudge,call_invite}_sent_at
 * in Supabase when env keys are present, so repeat runs skip already-sent emails
 * unless you pass --force.
 *
 * ---------------------------------------------------------------------------
 */

const path = require("path");
const fs   = require("fs");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });
const { Resend } = require("resend");
const { createClient } = require("@supabase/supabase-js");

const RESEND_KEY      = process.env.RESEND_API_KEY || "";
const BETA_FROM       = process.env.BETA_FROM      || "TravelBoop Beta <beta@travelboop.com>";
const BETA_REPLY_TO   = process.env.BETA_REPLY_TO  || "beta@travelboop.com";
const BETA_PASSWORD   = process.env.BETA_PASSWORD  || process.env.SITE_PASSWORD || "";
const BETA_BASE_URL   = process.env.BETA_BASE_URL  || "https://www.travelboop.com";
const BETA_CALENDAR   = process.env.BETA_CALENDAR_URL || "";

if (!RESEND_KEY) {
  console.error("RESEND_API_KEY missing in .env. See https://resend.com/api-keys");
  process.exit(1);
}
const resend = new Resend(RESEND_KEY);

const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// ─── CLI parsing ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const cmd  = args[0];
const dry  = args.includes("--dry");
const force = args.includes("--force");
const csvIdx = args.indexOf("--csv");
const csvPath = csvIdx >= 0 ? args[csvIdx + 1] : null;

const VALID_CMDS = new Set(["invite", "welcome", "nudge", "call"]);
if (!VALID_CMDS.has(cmd)) {
  console.error("Usage: node scripts/email/send-emails.js <invite|welcome|nudge|call> --csv <file> [--dry] [--force]");
  process.exit(1);
}

// ─── Recipient loading: prefer CSV, fall back to beta_invitees table ────────
async function loadRecipients() {
  if (csvPath) {
    const text = fs.readFileSync(csvPath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines.shift().split(",").map(s => s.trim().toLowerCase());
    const emailIdx = header.indexOf("email");
    const nameIdx  = header.indexOf("first_name");
    if (emailIdx < 0) throw new Error("CSV missing 'email' column header");
    return lines.map(line => {
      const cols = line.split(",").map(s => s.trim());
      return { email: cols[emailIdx]?.toLowerCase(), first_name: nameIdx >= 0 ? cols[nameIdx] : "" };
    }).filter(r => r.email);
  }
  if (supabase) {
    const sentColumn = {
      invite:  "invite_sent_at",
      welcome: "welcome_sent_at",
      nudge:   "nudge_sent_at",
      call:    "call_invite_sent_at",
    }[cmd];
    let query = supabase.from("beta_invitees").select("email,first_name");
    if (!force) query = query.is(sentColumn, null);
    const { data, error } = await query;
    if (error) throw new Error("Supabase load failed: " + error.message);
    return (data || []).map(r => ({ email: r.email, first_name: r.first_name }));
  }
  throw new Error("No --csv path and no SUPABASE_SERVICE_KEY — nothing to send to.");
}

// ─── Email templates (HTML + plain text). Inline styles for max client compat. ─
const BASE_STYLE = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  color: #1d1d1f; line-height: 1.5; max-width: 560px;
`;
const BTN_STYLE = `
  display: inline-block; padding: 12px 22px;
  background: #c9a96e; color: #1d1d1f !important; text-decoration: none;
  border-radius: 8px; font-weight: 600; font-size: 14px;
`;

function wrap(html) {
  return `<!DOCTYPE html><html><body style="background:#f5f3ee;padding:24px 12px;">
    <div style="${BASE_STYLE} background:#fff;padding:32px 28px;border-radius:14px;box-shadow:0 2px 12px rgba(0,0,0,.05);">
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#c9a96e;letter-spacing:.04em;margin-bottom:18px;">
        TravelBoop
      </div>
      ${html}
      <hr style="margin:28px 0 14px;border:0;border-top:1px solid #eee"/>
      <p style="font-size:11px;color:#888;margin:0;">
        You're receiving this because you signed up for the TravelBoop closed beta.
        Hit reply to talk to a human, or
        <a href="${BETA_BASE_URL}/privacy" style="color:#888">read our privacy policy</a>.
      </p>
    </div>
  </body></html>`;
}

function templates(name = "there") {
  const greet = name && name.length ? `Hi ${name},` : "Hi there,";
  const calendarLine = BETA_CALENDAR
    ? `<p>Want to chat? Grab 15 minutes here: <a href="${BETA_CALENDAR}">${BETA_CALENDAR}</a></p>`
    : "";
  return {
    invite: {
      subject: "You're in — TravelBoop closed beta",
      html: wrap(`
        <p>${greet}</p>
        <p>Welcome to the TravelBoop closed beta. We rebuilt hotel search around
        <strong>vibe</strong>: describe the room you actually want and we'll find it
        in real photos across Mexico City.</p>
        <p><strong>Beta password:</strong> <code style="background:#f0ece4;padding:3px 8px;border-radius:4px;font-size:14px;">${BETA_PASSWORD}</code></p>
        <p>Try this query first to see the magic:</p>
        <p style="background:#f7f4ec;padding:10px 14px;border-radius:6px;font-style:italic;color:#555;">
          "modern bathroom with double sinks in Roma Norte"
        </p>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Open TravelBoop →</a>
        </p>
        <p><strong>One ask:</strong> hit the round Feedback button (bottom-right) when
        anything feels off — bugs, slow searches, weird ranking, anything. We read
        every word.</p>
        <p>Heads-up: this is beta software. Things will break. We'll fix fast.</p>
        ${calendarLine}
        <p>— The TravelBoop team</p>
      `),
      text:
`${greet}

Welcome to the TravelBoop closed beta. We rebuilt hotel search around vibe:
describe the room you actually want and we'll find it in real photos across
Mexico City.

Beta password: ${BETA_PASSWORD}

Try this query first:
  "modern bathroom with double sinks in Roma Norte"

Open: ${BETA_BASE_URL}/

One ask: hit the round Feedback button (bottom-right) when anything feels off.
We read every word.

Heads-up: this is beta software. Things will break. We'll fix fast.
${BETA_CALENDAR ? `\nWant to chat? Grab 15 min: ${BETA_CALENDAR}\n` : ""}

— The TravelBoop team`,
    },
    welcome: {
      subject: "You're in — here's how to get the most out of it",
      html: wrap(`
        <p>${greet}</p>
        <p>Glad you made it in. Two minutes to get the most from your beta access:</p>
        <ol>
          <li><strong>Be specific.</strong> "modern bathroom with rainfall shower" beats "nice bathroom".</li>
          <li><strong>Use the Boop wizard once.</strong> It captures your vibe (5 quick questions) and personalises ranking.</li>
          <li><strong>Try the neighbourhood map.</strong> Each pin is a vibe %. Click one to filter results to that area.</li>
          <li><strong>Tell us what's off.</strong> Hit the Feedback button — even a 1-line "this is weird" helps.</li>
        </ol>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Jump back in →</a>
        </p>
        ${calendarLine}
        <p>— The TravelBoop team</p>
      `),
      text:
`${greet}

Glad you made it in. Two minutes to get the most from your beta access:

1. Be specific. "modern bathroom with rainfall shower" beats "nice bathroom".
2. Use the Boop wizard once. It captures your vibe (5 questions) and personalises ranking.
3. Try the neighbourhood map. Each pin is a vibe %. Click one to filter to that area.
4. Tell us what's off. Hit the Feedback button — even a 1-line "this is weird" helps.

Jump back in: ${BETA_BASE_URL}/
${BETA_CALENDAR ? `\nWant to chat? ${BETA_CALENDAR}\n` : ""}

— The TravelBoop team`,
    },
    nudge: {
      subject: "How's TravelBoop going? (30 sec to share)",
      html: wrap(`
        <p>${greet}</p>
        <p>You're a few days into the TravelBoop beta — what stuck and what didn't?</p>
        <p>Honest takes only. We're optimising for "would actually use this on my next trip".</p>
        <p>Three quick questions:</p>
        <ol>
          <li>What's the first thing that surprised you (good or bad)?</li>
          <li>Did the search results feel like they matched your vibe?</li>
          <li>Anything you wish existed?</li>
        </ol>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Open TravelBoop →</a>
        </p>
        <p>Hit reply to send the answers, or use the in-app Feedback button. Every reply
        moves the roadmap.</p>
        ${calendarLine}
        <p>— The TravelBoop team</p>
      `),
      text:
`${greet}

You're a few days into the TravelBoop beta — what stuck and what didn't?

Three quick questions:
1. What's the first thing that surprised you (good or bad)?
2. Did the search results feel like they matched your vibe?
3. Anything you wish existed?

Hit reply, or use the in-app Feedback button.

Open: ${BETA_BASE_URL}/
${BETA_CALENDAR ? `\nWant to chat? ${BETA_CALENDAR}\n` : ""}

— The TravelBoop team`,
    },
    call: {
      subject: "15 min to make TravelBoop better?",
      html: wrap(`
        <p>${greet}</p>
        <p>Thanks for spending time in TravelBoop these past two weeks. Now we'd love
        15 minutes of your brain.</p>
        <p>One quick call: we screen-share, you walk through how you'd use it for a
        real trip, we listen. No pitch, no slides.</p>
        ${BETA_CALENDAR
          ? `<p style="margin:24px 0;">
              <a href="${BETA_CALENDAR}" style="${BTN_STYLE}">Pick a slot →</a>
            </p>`
          : `<p>Reply with three windows that work for you and we'll send a calendar invite.</p>`
        }
        <p>Either way — thanks for being early. It really matters.</p>
        <p>— The TravelBoop team</p>
      `),
      text:
`${greet}

Thanks for spending time in TravelBoop these past two weeks. Now we'd love
15 minutes of your brain.

One quick call: we screen-share, you walk through how you'd use it for a
real trip, we listen. No pitch, no slides.

${BETA_CALENDAR ? `Pick a slot: ${BETA_CALENDAR}` : "Reply with three windows that work for you."}

— The TravelBoop team`,
    },
  };
}

const SENT_COL = {
  invite:  "invite_sent_at",
  welcome: "welcome_sent_at",
  nudge:   "nudge_sent_at",
  call:    "call_invite_sent_at",
};

(async () => {
  const recipients = await loadRecipients();
  if (!recipients.length) {
    console.log("No recipients to send to. (Use --force to re-send to people already marked sent.)");
    process.exit(0);
  }
  console.log(`[email] flow=${cmd} recipients=${recipients.length} dry=${dry}`);

  let ok = 0, fail = 0;
  for (const r of recipients) {
    const t = templates(r.first_name)[cmd];
    if (dry) {
      console.log(`[dry] would send "${t.subject}" → ${r.email}`);
      ok++;
      continue;
    }
    try {
      const result = await resend.emails.send({
        from: BETA_FROM,
        to:   r.email,
        replyTo: BETA_REPLY_TO,
        subject: t.subject,
        html:    t.html,
        text:    t.text,
      });
      if (result?.error) throw new Error(result.error.message || JSON.stringify(result.error));
      console.log(`[ok]  ${r.email} (id=${result?.data?.id || "?"})`);
      ok++;
      if (supabase) {
        const patch = { [SENT_COL[cmd]]: new Date().toISOString() };
        if (cmd === "invite" && r.email) patch.status = "invited";
        const { error } = await supabase
          .from("beta_invitees")
          .upsert({ email: r.email.toLowerCase(), first_name: r.first_name || null, ...patch }, { onConflict: "email" });
        if (error) console.warn(`  [warn] supabase update failed for ${r.email}: ${error.message}`);
      }
      // Resend free tier ~ 2 req/sec. Be polite.
      await new Promise(rs => setTimeout(rs, 600));
    } catch (e) {
      fail++;
      console.error(`[err] ${r.email}: ${e.message}`);
    }
  }
  console.log(`[email] done — ok=${ok} fail=${fail}`);
})();
