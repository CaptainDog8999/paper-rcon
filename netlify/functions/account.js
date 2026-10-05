const crypto = require("crypto");
const { getStore } = require("@netlify/blobs");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function openStore(name) {
  const siteID = process.env.BLOBS_SITE_ID || process.env.SITE_ID || "";
  const token = process.env.BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || "";
  if (siteID && token) return getStore({ name, siteID, token });
  return getStore(name);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 32).toString("hex");
}

exports.handler = async function handler(event) {
  try {
    if (event.httpMethod !== "POST") return json(405, { message: "Use POST" });
    const body = JSON.parse(event.body || "{}");
    const name = String(body.name || "").trim().toLowerCase();
    const password = String(body.password || "");
    const action = body.action === "register" ? "register" : "login";
    if (!/^[a-z0-9][a-z0-9_-]{2,20}$/.test(name)) {
      return json(400, { message: "Username must be 3 to 21 letters or numbers." });
    }
    if (password.length < 6 || password.length > 80) {
      return json(400, { message: "Password must be at least 6 characters." });
    }
    const accounts = openStore("accounts");
    const sessions = openStore("sessions");
    const existing = await accounts.get(name, { type: "json" });
    if (action === "register") {
      if (existing) return json(409, { message: "That username is already taken." });
      const salt = crypto.randomBytes(16).toString("hex");
      await accounts.setJSON(name, { name, salt, hash: hashPassword(password, salt) });
    } else if (!existing) {
      return json(401, { message: "No account with that username yet. Click Create account first." });
    } else if (hashPassword(password, existing.salt) !== existing.hash) {
      return json(401, { message: "Username or password is wrong." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    await sessions.setJSON(token, { name, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    return json(200, { token, name });
  } catch (err) {
    return json(500, { message: err.message || "Could not sign in" });
  }
};
