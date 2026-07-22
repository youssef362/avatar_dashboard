// POST /api/webhook?token=YOUR_TOKEN  — GitHub calls this on new issue comments.
// Sends: (1) a general "new comment" alert, and (2) an @-mention ping for anyone named.
const esc = (s = "") => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function users(){ try{ return JSON.parse(process.env.USERS_JSON||"[]"); }catch{ return []; } }
function findMentions(text=""){
  const toks=new Set((text.match(/@([A-Za-z0-9_]+)/g)||[]).map(t=>t.slice(1).toLowerCase()));
  return users().filter(u=>{
    const name=String(u.name||"").toLowerCase(), first=name.split(" ")[0];
    return toks.has(String(u.username||"").toLowerCase()) || toks.has(name) || (first && toks.has(first));
  });
}
async function tg(text){
  await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode:"HTML", disable_web_page_preview:true }),
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GITHUB_WEBHOOK_TOKEN } = process.env;
  if (GITHUB_WEBHOOK_TOKEN && req.query.token !== GITHUB_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return res.status(500).json({ error: "Missing Telegram env vars." });

  const event = req.headers["x-github-event"];
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

  if (event === "issue_comment" && body.action === "created" && body.issue && body.comment) {
    const rawBody = body.comment.body || "";
    const title = (body.issue.title || "").replace(/^\[\w+\]\s*/, "");
    const author = (rawBody.match(/<!--\s*author:(.*?)\s*-->/) || [])[1]?.trim() || body.comment.user?.login || "someone";
    const clean = rawBody.replace(/<!--\s*author:.*?-->/, "").replace(/^\s*\*\*.*?:\*\*\s*/, "").trim();
    const link = body.comment.html_url || body.issue.html_url;

    try {
      // (1) general comment alert
      await tg([`💬 <b>New comment</b> on: ${esc(title)}`, `By: ${esc(author)}`, clean ? `\n${esc(clean).slice(0,300)}` : "", `\n🔗 ${link}`].filter(Boolean).join("\n"));

      // (2) mention pings
      const mentioned = findMentions(rawBody);
      for (const u of mentioned) {
        if (u.name && u.name.toLowerCase() === String(author).toLowerCase()) continue; // don't ping self
        await tg(`👋 Hi ${esc(u.telegram || u.name)}, you were mentioned on <b>${esc(title)}</b> by ${esc(author)}. Please take a look:\n🔗 ${link}`);
      }
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(200).json({ ok: true });
}
