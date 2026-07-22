// /api/comments  — GET ?number=  (list) | POST { number, body }  (add)
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

export default async function handler(req, res) {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) return res.status(500).json({ error: "Missing GITHUB_TOKEN / GITHUB_REPO." });

  const user = requireUser(req);
  if (!user.ok) return res.status(401).json({ error: "Please sign in." });

  const gh = (path, opts = {}) =>
    fetch(`https://api.github.com/repos/${GITHUB_REPO}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
    });

  try {
    if (req.method === "GET") {
      const number = req.query.number;
      if (!number) return res.status(400).json({ error: "number is required" });
      const r = await gh(`/issues/${number}/comments?per_page=100`);
      if (!r.ok) return res.status(502).json({ error: `GitHub error: ${r.status}` });
      const raw = await r.json();
      const comments = raw.map((c) => {
        const b = c.body || "";
        const author = (b.match(/<!--\s*author:(.*?)\s*-->/) || [])[1]?.trim() || c.user?.login || "unknown";
        const text = b.replace(/<!--\s*author:.*?-->/, "").replace(/^\s*\*\*.*?:\*\*\s*/, "").trim();
        return { author, body: text, created_at: c.created_at };
      });
      return res.status(200).json({ ok: true, comments });
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      // author is the signed-in user; only fall back to a supplied name when auth is off
      const author = user.unguarded ? body.author : user.name;
      const { number, body: text } = body;
      if (!number || !author || !text) return res.status(400).json({ error: "number, author and body are required" });

      const safeAuthor = String(author).replace(/[|>\n]/g, "").trim();
      const composed = `**${safeAuthor}:**\n\n${text}\n\n<!-- author:${safeAuthor} -->`;
      const r = await gh(`/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: composed }) });
      if (!r.ok) {
        const d = await r.text();
        return res.status(502).json({ error: `GitHub error: ${r.status} ${d.slice(0, 150)}` });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}
