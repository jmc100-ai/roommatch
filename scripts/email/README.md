# Beta email scripts

One file (`send-emails.js`), four flows, all backed by Resend.

## Setup

1. Create a Resend account: https://resend.com (free tier: 100 emails/day, 3000/month).
2. Add your sending domain (`travelbyvibe.com`) and finish DNS verification.
3. Generate an API key.
4. Set in `.env`:
   ```
   RESEND_API_KEY=re_...
   BETA_PASSWORD=the-password-you-rotated-for-beta
   BETA_FROM="TravelByVibe Beta <beta@travelbyvibe.com>"
   BETA_REPLY_TO=beta@travelbyvibe.com
   BETA_BASE_URL=https://www.travelbyvibe.com
   BETA_CALENDAR_URL=https://cal.com/your-handle    # optional
   ```
5. Apply the DB migration: `supabase/add-beta-tables.sql` (creates `beta_invitees`).

## Recipient sources

Two ways to feed addresses, pick whichever is easier per send:

- **CSV** (`--csv invitees.csv`): two columns — `email,first_name`. Ignores duplicates if Supabase is configured.
- **Supabase table** (no `--csv`): pulls from `beta_invitees` where the matching `*_sent_at` column is null. Use `--force` to re-send.

## Flows

```bash
# 1. Initial invite — go-live email with the password
node scripts/email/send-emails.js invite --csv invitees.csv

# 2. Welcome / day-2 — sent ~36-48h after invite, only to people who haven't activated
node scripts/email/send-emails.js welcome --csv invitees.csv

# 3. Week-1 nudge — "30 sec to share?"
node scripts/email/send-emails.js nudge --csv invitees.csv

# 4. Week-2 call ask
node scripts/email/send-emails.js call --csv invitees.csv

# Dry-run any of the above to see who would be emailed without sending:
node scripts/email/send-emails.js invite --csv invitees.csv --dry

# Force re-send to people already marked sent:
node scripts/email/send-emails.js invite --csv invitees.csv --force
```

## Notes

- Inline-styled HTML + plain-text fallback for max email-client compatibility.
- Sends are throttled at ~600ms apart (well under Resend's free-tier rate cap).
- After each successful send, `beta_invitees.{flow}_sent_at` is updated so re-runs skip already-sent rows.
- Edit copy in `templates(name)` inside `send-emails.js`. Keep messages short — beta testers' inboxes are full.
