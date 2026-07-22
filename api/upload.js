// POST /api/upload  { filename, mimeType, dataBase64 }
// Forwards the file to your Google Apps Script web app, which saves it to your Drive.
// Returns { url }. If DRIVE_UPLOAD_URL isn't set, returns 501 so the form can skip attachments.
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
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!requireUser(req).ok) return res.status(401).json({ error: "Please sign in." });

  const { DRIVE_UPLOAD_URL } = process.env;
  if (!DRIVE_UPLOAD_URL) {
    return res.status(501).json({ error: "Drive upload not configured." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const { filename, mimeType, dataBase64 } = body;
  if (!dataBase64 || !filename) {
    return res.status(400).json({ error: "filename and dataBase64 are required." });
  }

  try {
    const r = await fetch(DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, mimeType, dataBase64 }),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { ok: false, error: text.slice(0, 200) }; }
    if (!data.ok) return res.status(502).json({ error: data.error || "Drive script error" });
    return res.status(200).json({ url: data.url, id: data.id });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Unexpected error" });
  }
}
