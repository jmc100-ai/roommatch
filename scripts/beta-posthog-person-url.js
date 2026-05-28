/**
 * Build a PostHog person URL for beta triage (Slack/email). Requires
 * POSTHOG_PROJECT_URL e.g. https://us.posthog.com/project/12345 (no trailing slash).
 */
function betaPosthogPersonUrl(distinctId) {
  const base = String(process.env.POSTHOG_PROJECT_URL || "").replace(/\/$/, "");
  const id = String(distinctId || "").trim();
  if (!base || !id) return null;
  return `${base}/person/${encodeURIComponent(id)}`;
}

module.exports = { betaPosthogPersonUrl };
