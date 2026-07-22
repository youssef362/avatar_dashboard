// POST /api/report  — creates a GitHub issue + pings Telegram.
import crypto from "crypto";

function requireUser(req){
  const secret=process.env.AUTH_SECRET;
  if(!secret) return {ok:true,unguarded:true,name:""};
  const h=req.headers.authorization||""; const t=h.startsWith("Bearer ")?h.slice(7):"";
  const [p,sig]=t.split("."); if(!p||!sig) return {ok:false};
  const exp=crypto.createHmac("sha256",secret).update(p).digest("base64url");
  if(sig!==exp) return {ok:false};
  try{const o=JSON.parse(Buffer.from(p,"base64url").toString());if(o.exp&&Date.now()>o.exp)return {ok:false};return {ok:true,...o};}catch{return {ok:false};}
}
function users(){ try{ return JSON.parse(process.env.USERS_JSON||"[]"); }catch{ return []; } }
function handleFor(name){
  const u=users().find(x=>String(x.name||"").toLowerCase()===String(name||"").toLowerCase());
  return u?.telegram || name || "team";
}
const escapeHtml=(s="")=>s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = requireUser(req);
  if (!user.ok) return res.status(401).json({ error: "Please sign in." });

  const { GITHUB_TOKEN, GITHUB_REPO, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return res.status(500).json({ error: "Server is missing environment variables." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { type = "Bug", title, description = "", assignee = "", deadline = null, attachments = [] } = body;
  // reporter comes from the logged-in identity when auth is on
  const reporter = user.unguarded ? (body.reporter || "") : user.name;

  if (!title || !reporter) return res.status(400).json({ error: "title and reporter are required." });

  const lines = [`**Type:** ${type}`, `**Reported by:** ${reporter}`];
  if (assignee) lines.push(`**Assigned to:** ${assignee}`);
  if (deadline) lines.push(`**Deadline:** ${new Date(deadline).toLocaleString()}`);
  lines.push("", description || "_No details provided._");
  if (attachments.length) {
    lines.push("", "**Attachments:**");
    for (const a of attachments) {
      const icon = a.type === "image" ? "🖼️" : a.type === "voice" ? "🎧" : "📄";
      lines.push(`- ${icon} [${a.name || a.type}](${a.url})`);
    }
  }
  if (deadline) lines.push("", `<!-- due:${new Date(deadline).toISOString()} -->`);
  for (const a of attachments) lines.push(`<!-- attach:${a.type}|${String(a.name || "").replace(/\|/g, "-")}|${a.url} -->`);

  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title: `[${type}] ${title}`, body: lines.join("\n"), labels: [type.toLowerCase()] }),
    });
    if (!ghRes.ok) {
      const detail = await ghRes.text();
      return res.status(502).json({ error: `GitHub error: ${ghRes.status} ${detail.slice(0, 200)}` });
    }
    const issue = await ghRes.json();

    const emoji = type === "Bug" ? "🐞" : type === "Task" ? "✅" : "📋";
    const who = assignee ? handleFor(assignee) : "team";
    const tgLines = [
      `${emoji} <b>New ${type}</b>`,
      `Hi ${escapeHtml(who)}, ${escapeHtml(reporter)} created a new ${type.toLowerCase()} — please check the details and deadline.`,
      `<b>${escapeHtml(title)}</b>`,
    ];
    if (deadline) tgLines.push(`⏰ Deadline: ${escapeHtml(new Date(deadline).toLocaleString())}`);
    if (description) tgLines.push(`\n${escapeHtml(description).slice(0, 400)}`);
    if (attachments.length) for (const a of attachments) tgLines.push(`📎 <a href="${a.url}">${escapeHtml(a.name || a.type)}</a>`);
    tgLines.push(`\n🔗 ${issue.html_url}`);

    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: tgLines.join("\n"), parse_mode: "HTML", disable_web_page_preview: true }),
    });

    return res.status(200).json({ ok: true, url: issue.html_url, number: issue.number });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}
