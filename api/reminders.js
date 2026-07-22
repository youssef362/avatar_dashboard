// GET /api/reminders  (runs daily via Vercel cron)
// For each OPEN task with a deadline:
//   - due within the next 24h  -> "Hi {assignee}, please share an update" + link
//   - overdue within the last 24h -> a one-time "this task is overdue" nudge + link
// Protected by CRON_SECRET (Vercel sends it automatically; GitHub Actions passes it).

// Handles come from USERS_JSON (single source of truth).
function users(){ try{ return JSON.parse(process.env.USERS_JSON||"[]"); }catch{ return []; } }
const mention = (name = "") => {
  const u = users().find(x => String(x.name||"").toLowerCase() === String(name).toLowerCase());
  return u?.telegram || name || "team";
};
const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export default async function handler(req, res) {
  const { GITHUB_TOKEN, GITHUB_REPO, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET } = process.env;

  if (CRON_SECRET) {
    if ((req.headers.authorization || "") !== `Bearer ${CRON_SECRET}`) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }
  if (!GITHUB_TOKEN || !GITHUB_REPO || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: "Missing environment variables." });
  }

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/issues?state=open&per_page=100`,
      { headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
      } }
    );
    if (!r.ok) {
      const d = await r.text();
      return res.status(502).json({ error: `GitHub error: ${r.status} ${d.slice(0, 200)}` });
    }
    const issues = await r.json();

    let sent = 0;
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const body = issue.body || "";
      const m = body.match(/<!--\s*due:(.*?)\s*-->/);
      if (!m) continue;
      const due = new Date(m[1]);
      if (isNaN(due)) continue;

      const diff = due.getTime() - now;
      const assignee = (body.match(/\*\*Assigned to:\*\*\s*(.+)/) || [])[1]?.trim() || "";
      const who = mention(assignee);
      const title = issue.title.replace(/^\[\w+\]\s*/, "");

      let text = null;
      if (diff > 0 && diff <= DAY) {
        text = `⏰ Hi ${esc(who)}, please share an update on this task:\n<b>${esc(title)}</b>\nDeadline: ${due.toLocaleString()}\n🔗 ${issue.html_url}`;
      } else if (diff < 0 && diff >= -DAY) {
        text = `🔴 Hi ${esc(who)}, this task is now overdue:\n<b>${esc(title)}</b>\nWas due: ${due.toLocaleString()}\n🔗 ${issue.html_url}`;
      }

      if (text) {
        await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, text);
        sent++;
      }
    }

    return res.status(200).json({ ok: true, reminders: sent });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}

async function sendTelegram(token, chatId, text) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!r.ok) throw new Error(`Telegram error: ${r.status}`);
}
