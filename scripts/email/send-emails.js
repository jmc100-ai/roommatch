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
 *               BETA_FROM (default beta@travelbyvibe.com), BETA_REPLY_TO (default
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
const BETA_FROM       = process.env.BETA_FROM      || "TravelByVibe Beta <beta@travelbyvibe.com>";
const BETA_REPLY_TO   = process.env.BETA_REPLY_TO  || "beta@travelbyvibe.com";
const BETA_PASSWORD   = process.env.BETA_PASSWORD  || process.env.SITE_PASSWORD || "";
const BETA_BASE_URL   = process.env.BETA_BASE_URL  || "https://www.travelbyvibe.com";
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
      <div style="font-family:'Cormorant Garamond',Georgia,serif;font-size:22px;font-weight:600;color:#e8e4dc;letter-spacing:.04em;margin-bottom:18px;">
        TravelBy<span style="color:#c9a96e">Vibe</span>
      </div>
      ${html}
      <hr style="margin:28px 0 14px;border:0;border-top:1px solid #eee"/>
      <p style="font-size:11px;color:#888;margin:0;">
        You are receiving this because you joined the TravelByVibe beta waitlist or invite list.
        Reply to this email to reach a real person, or
        <a href="${BETA_BASE_URL}/privacy" style="color:#888">read our privacy note</a>.
      </p>
    </div>
  </body></html>`;
}

function templates(name = "there") {
  const greet = name && name.length ? `Hi ${name},` : "Hi there,";
  const calendarLine = BETA_CALENDAR
    ? `<p>Want to chat live? <a href="${BETA_CALENDAR}">Grab a 15-minute slot here</a>.</p>`
    : "";
  return {
    invite: {
      subject: "You're in — welcome to the TravelByVibe beta",
      html: wrap(`
        <p>${greet}</p>
        <p>Welcome to the TravelByVibe beta for Mexico City. Tell us the room you have in mind — rain shower, sunny balcony, moody suite — and we will line up
        <strong>real hotel photos</strong> so you can judge with your eyes, not just a star count.</p>
        <p><strong>Your beta code:</strong> <code style="background:#f0ece4;padding:3px 8px;border-radius:4px;font-size:14px;">${BETA_PASSWORD}</code></p>
        <p>Try a first search like this:</p>
        <p style="background:#f7f4ec;padding:10px 14px;border-radius:6px;font-style:italic;color:#555;">
          "modern bathroom with double sinks in Roma Norte"
        </p>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Open TravelByVibe →</a>
        </p>
        <p><strong>Small favour:</strong> tap the purple <strong>Feedback</strong> bubble anytime something feels confusing, slow, or surprisingly great. We read every note.</p>
        <p>We are still polishing — if something looks off, tell us and we will jump on it.</p>
        ${calendarLine}
        <p>— The TravelByVibe team</p>
      `),
      text:
`${greet}

Welcome to the TravelByVibe beta for Mexico City. Describe the room you want and
we will match it to real hotel photos so you can see what you are booking toward.

Your beta code: ${BETA_PASSWORD}

Try a first search like:
  "modern bathroom with double sinks in Roma Norte"

Open: ${BETA_BASE_URL}/

Small favour: tap the purple Feedback bubble when anything feels off — we read
every note.

We are still polishing; if something breaks, tell us and we will fix it fast.
${BETA_CALENDAR ? `\nWant to chat live? ${BETA_CALENDAR}\n` : ""}

— The TravelByVibe team`,
    },
    welcome: {
      subject: "Quick tips for your TravelByVibe beta",
      html: wrap(`
        <p>${greet}</p>
        <p>Glad you are here. Four tiny habits that make the beta feel great:</p>
        <ol>
          <li><strong>Say it like you mean it.</strong> “Rain shower, double vanity, lots of light” beats “nice bathroom”.</li>
          <li><strong>Run the five-tap wizard once.</strong> It captures how you travel so rankings feel personal.</li>
          <li><strong>Open the neighborhood map on desktop.</strong> Tap a pin to focus the hotel list on that area.</li>
          <li><strong>Send a one-line note.</strong> Purple Feedback bubble — even “this felt weird” moves the roadmap.</li>
        </ol>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Jump back in →</a>
        </p>
        ${calendarLine}
        <p>— The TravelByVibe team</p>
      `),
      text:
`${greet}

Glad you are here. Four tiny habits that make the beta feel great:

1. Say it like you mean it — specific beats vague.
2. Run the five-tap wizard once so rankings feel personal.
3. On desktop, try the neighborhood map and tap a pin to focus the list.
4. Hit Feedback with even one sentence — it all helps.

Jump back in: ${BETA_BASE_URL}/
${BETA_CALENDAR ? `\nWant to chat live? ${BETA_CALENDAR}\n` : ""}

— The TravelByVibe team`,
    },
    nudge: {
      subject: "How is TravelByVibe feeling for you?",
      html: wrap(`
        <p>${greet}</p>
        <p>You have been in the TravelByVibe beta for a few days — we would love a gut check.</p>
        <p>What felt instantly useful? What felt confusing? There are no wrong answers.</p>
        <p>Three quick prompts:</p>
        <ol>
          <li>What surprised you first — in a good or bad way?</li>
          <li>Did the hotel picks feel close to the vibe you described?</li>
          <li>What is one thing you wish the product did tomorrow?</li>
        </ol>
        <p style="margin:24px 0;">
          <a href="${BETA_BASE_URL}/" style="${BTN_STYLE}">Open TravelByVibe →</a>
        </p>
        <p>Reply to this email with a sentence or two, or tap the purple Feedback bubble in the app — both land with us.</p>
        ${calendarLine}
        <p>— The TravelByVibe team</p>
      `),
      text:
`${greet}

You have been in the TravelByVibe beta for a few days — we would love a gut check.

Three quick prompts:
1. What surprised you first — good or bad?
2. Did the hotel picks feel close to the vibe you described?
3. What is one thing you wish existed tomorrow?

Reply here or use the in-app Feedback bubble.

Open: ${BETA_BASE_URL}/
${BETA_CALENDAR ? `\nWant to chat live? ${BETA_CALENDAR}\n` : ""}

— The TravelByVibe team`,
    },
    call: {
      subject: "Could we borrow 15 minutes of your time?",
      html: wrap(`
        <p>${greet}</p>
        <p>Thank you for living in TravelByVibe lately — you have already taught us a ton.</p>
        <p>If you are up for it, we would love a relaxed 15-minute video chat: you share your screen, walk us through a real trip you would plan, and we mostly listen. No sales deck, we promise.</p>
        ${BETA_CALENDAR
          ? `<p style="margin:24px 0;">
              <a href="${BETA_CALENDAR}" style="${BTN_STYLE}">Pick a time that works →</a>
            </p>`
          : `<p>Reply with a few times that work and we will send a calendar invite.</p>`
        }
        <p>Either way, thank you for being early — it genuinely helps.</p>
        <p>— The TravelByVibe team</p>
      `),
      text:
`${greet}

Thank you for using TravelByVibe lately — you have already taught us a ton.

If you are up for it, we would love a relaxed 15-minute video chat: you share
your screen, walk us through a real trip, we listen. No sales deck.

${BETA_CALENDAR ? `Pick a time: ${BETA_CALENDAR}` : "Reply with a few windows that work for you."}

— The TravelByVibe team`,
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
