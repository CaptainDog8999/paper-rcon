const crypto = require("crypto");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function blobContext() {
  const raw = process.env.NETLIFY_BLOBS_CONTEXT || "";
  if (!raw) {
    const error = new Error("Account storage is not ready on this deploy. Trigger a new Netlify deploy.");
    error.statusCode = 503;
    throw error;
  }
  return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
}

function blobUrl(store, key) {
  const ctx = blobContext();
  const url = new URL(`/${ctx.siteID}/${encodeURIComponent(store)}/${encodeURIComponent(key)}`, ctx.apiURL);
  return { url, token: ctx.token };
}

async function blobGet(store, key) {
  const { url, token } = blobUrl(store, key);
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not read saved account (${res.status})`);
  return res.json();
}

async function blobSet(store, key, value) {
  const { url, token } = blobUrl(store, key);
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Could not save account (${res.status})`);
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
    const existing = await blobGet("accounts", name);
    if (action === "register") {
      if (existing) return json(409, { message: "That username is already taken." });
      const salt = crypto.randomBytes(16).toString("hex");
      await blobSet("accounts", name, { name, salt, hash: hashPassword(password, salt) });
    } else if (!existing) {
      return json(401, { message: "No account with that username yet. Click Create account first." });
    } else if (hashPassword(password, existing.salt) !== existing.hash) {
      return json(401, { message: "Username or password is wrong." });
    }
    const token = crypto.randomBytes(24).toString("hex");
    await blobSet("sessions", token, { name, expires: Date.now() + 1000 * 60 * 60 * 24 * 30 });
    return json(200, { token, name });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Could not sign in" });
  }
};
