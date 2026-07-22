// GET /api/mentions-check  — run every ~3h by a GitHub Action.
// For each open task, finds mentions with no reply from the mentioned person
// and (if the mention is >3h old and still unanswered) re-pings them on Telegram.
// Stateless: because the job runs every 3h, an unanswered mention gets re-pinged
// roughly every 3h until that person comments on the task.

const HANDLE = {};
function users(){ try{ return JSON.parse(process.env.USERS_JSON||"[]"); }catch{ return []; } }
function mentionedUsers(text=""){
  const toks=new Set((text.match(/@([A-Za-z0-9_]+)/g)||[]).map(t=>t.slice(1).toLowerCase()));
  return users().filter(u=>{
    const name=String(u.name||"").toLowerCase(), first=name.split(" ")[0];
    return toks.has(String(u.username||"").toLowerCase()) || toks.has(name) || (first && toks.has(first));
  });
}
const esc=(s="")=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

export default async function handler(req, res) {
  const { GITHUB_TOKEN, GITHUB_REPO, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, CRON_SECRET } = process.env;
  if (CRON_SECRET && (req.headers.authorization || "") !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!GITHUB_TOKEN || !GITHUB_REPO || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: "Missing environment variables." });
  }

  const now = Date.now();
  const THREE_H = 3 * 60 * 60 * 1000;
  const ghHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  try {
    const issuesRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues?state=open&per_page=100`, { headers: ghHeaders });
    if (!issuesRes.ok) return res.status(502).json({ error: `GitHub error: ${issuesRes.status}` });
    const issues = await issuesRes.json();

    let pinged = 0;
    for (const issue of issues) {
      if (issue.pull_request) continue;
      const cRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues/${issue.number}/comments?per_page=100`, { headers: ghHeaders });
      if (!cRes.ok) continue;
      const rawComments = await cRes.json();
      const comments = rawComments.map((c) => {
        const b = c.body || "";
        return {
          author: (b.match(/<!--\s*author:(.*?)\s*-->/) || [])[1]?.trim() || c.user?.login || "",
          text: b,
          t: new Date(c.created_at).getTime(),
        };
      });

      const title = (issue.title || "").replace(/^\[\w+\]\s*/, "");

      for (const u of users()) {
        // latest time this user was mentioned
        let lastMention = 0;
        for (const c of comments) {
          if (mentionedUsers(c.text).some((m) => m.username === u.username)) {
            if (c.t > lastMention) lastMention = c.t;
          }
        }
        if (!lastMention) continue;

        // latest time this user replied
        let lastReply = 0;
        for (const c of comments) {
          if (String(c.author).toLowerCase() === String(u.name).toLowerCase() && c.t > lastReply) lastReply = c.t;
        }

        const unanswered = lastReply <= lastMention;
        const ageOK = now - lastMention >= THREE_H;
        if (unanswered && ageOK) {
          await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: TELEGRAM_CHAT_ID,
              text: `🔁 Hi ${esc(u.telegram || u.name)}, you still have an unanswered mention on <b>${esc(title)}</b> — please reply:\n🔗 ${issue.html_url}`,
              parse_mode: "HTML",
              disable_web_page_preview: true,
            }),
          });
          pinged++;
        }
      }
    }

    return res.status(200).json({ ok: true, pinged });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}
