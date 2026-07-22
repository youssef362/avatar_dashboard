// POST /api/login  { username, password }  -> { token, name }
import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { AUTH_SECRET, USERS_JSON } = process.env;
  if (!AUTH_SECRET || !USERS_JSON) {
    return res.status(500).json({ error: "Login is not configured." });
  }

  let users = [];
  try { users = JSON.parse(USERS_JSON); } catch { return res.status(500).json({ error: "USERS_JSON is invalid." }); }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");

  const u = users.find(
    (x) => String(x.username || "").toLowerCase() === username && String(x.password) === password
  );
  if (!u) return res.status(401).json({ error: "Wrong username or password." });

  const payload = {
    username: u.username,
    name: u.name || u.username,
    telegram: u.telegram || "",
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", AUTH_SECRET).update(p).digest("base64url");
  return res.status(200).json({ token: `${p}.${sig}`, name: payload.name });
}
