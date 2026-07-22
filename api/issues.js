// GET /api/issues
// Reads open + closed issues from GitHub and returns a clean, flat list for the dashboard.
// The GitHub token stays server-side; the browser only sees parsed fields.
import crypto from "crypto";
function requireUser(req){
  const secret=process.env.AUTH_SECRET;
  if(!secret) return {ok:true};
  const h=req.headers.authorization||""; const t=h.startsWith("Bearer ")?h.slice(7):"";
  const [p,sig]=t.split("."); if(!p||!sig) return {ok:false};
  const exp=crypto.createHmac("sha256",secret).update(p).digest("base64url");
  if(sig!==exp) return {ok:false};
  try{const o=JSON.parse(Buffer.from(p,"base64url").toString());if(o.exp&&Date.now()>o.exp)return {ok:false};return {ok:true};}catch{return {ok:false};}
}

export default async function handler(req, res) {
  const { GITHUB_TOKEN, GITHUB_REPO } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: "Missing GITHUB_TOKEN / GITHUB_REPO." });
  }
  if (!requireUser(req).ok) return res.status(401).json({ error: "Please sign in." });

  try {
    const all = [];
    // Paginate up to 5 pages (500 issues) — plenty for a team tool.
    for (let page = 1; page <= 5; page++) {
      const r = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/issues?state=all&per_page=100&page=${page}&sort=created&direction=desc`,
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );
      if (!r.ok) {
        const d = await r.text();
        return res.status(502).json({ error: `GitHub error: ${r.status} ${d.slice(0, 200)}` });
      }
      const batch = await r.json();
      all.push(...batch);
      if (batch.length < 100) break;
    }

    const items = all
      .filter((i) => !i.pull_request) // issues only
      .map((i) => {
        const body = i.body || "";
        const type =
          (i.labels || []).map((l) => (typeof l === "string" ? l : l.name))
            .find((n) => ["bug", "task", "case"].includes((n || "").toLowerCase())) ||
          (i.title.match(/^\[(\w+)\]/)?.[1] || "issue");

        // attachments from <!-- attach:type|name|url --> markers
        const attachments = [];
        const re = /<!--\s*attach:([^|]+)\|([^|]*)\|(.*?)\s*-->/g;
        let mm;
        while ((mm = re.exec(body))) {
          attachments.push({ type: mm[1].trim(), name: mm[2].trim(), url: mm[3].trim() });
        }

        // description = body minus metadata lines, list items, and markers
        const description = body
          .replace(/<!--[\s\S]*?-->/g, "")
          .split("\n")
          .filter((l) => {
            const t = l.trim();
            if (!t) return false;
            if (/^\*\*(Type|Reported by|Assigned to|Deadline|Attachments):\*\*/.test(t)) return false;
            if (/^-\s/.test(t)) return false;
            return true;
          })
          .join("\n")
          .trim()
          .replace(/^_No details provided\._$/, "");

        return {
          number: i.number,
          title: i.title.replace(/^\[\w+\]\s*/, ""),
          type: cap(type),
          reporter: (body.match(/\*\*Reported by:\*\*\s*(.+)/) || [])[1]?.trim() || "",
          assignee: (body.match(/\*\*Assigned to:\*\*\s*(.+)/) || [])[1]?.trim() || "",
          deadline: (body.match(/<!--\s*due:(.*?)\s*-->/) || [])[1] || null,
          description,
          attachments,
          comments: i.comments || 0,
          state: i.state, // "open" | "closed"
          created_at: i.created_at,
          url: i.html_url,
        };
      });

    // Cache at the edge for 30s to avoid hammering the GitHub API.
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({ ok: true, count: items.length, items });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}

function cap(s = "") {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
