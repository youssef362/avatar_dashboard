// GET /api/config  — public. Lets the frontend know if a login wall is on.
export default async function handler(req, res) {
  res.status(200).json({ authRequired: !!process.env.AUTH_SECRET });
}
