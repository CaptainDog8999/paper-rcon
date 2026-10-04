const { getStore } = require("@netlify/blobs");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

async function googleUser(event) {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  if (!clientId) {
    const error = new Error("Google sign-in is not set up yet");
    error.statusCode = 503;
    throw error;
  }
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Sign in with Google first");
    error.statusCode = 401;
    throw error;
  }
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`);
  if (!res.ok) {
    const error = new Error("Google sign-in expired. Sign in again.");
    error.statusCode = 401;
    throw error;
  }
  const info = await res.json();
  if (info.aud !== clientId || info.email_verified !== "true") {
    const error = new Error("That Google account is not allowed");
    error.statusCode = 403;
    throw error;
  }
  return { id: info.sub, email: info.email, name: info.name || info.email };
}

function cleanPresets(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => ({
    id: String(item.id || Date.now()),
    name: String(item.name || "Server").slice(0, 40),
    ip: String(item.ip || "").slice(0, 120),
    port: String(item.port || "25575").slice(0, 6),
    password: String(item.password || "").slice(0, 120),
  })).filter((item) => item.ip && item.port);
}

exports.handler = async function handler(event) {
  try {
    const user = await googleUser(event);
    const store = getStore("server-presets");
    if (event.httpMethod === "GET") {
      const saved = (await store.get(user.id, { type: "json" })) || { presets: [] };
      return json(200, { email: user.email, name: user.name, presets: saved.presets || [] });
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const presets = cleanPresets(body.presets);
      await store.setJSON(user.id, { email: user.email, presets });
      return json(200, { email: user.email, presets });
    }
    return json(405, { message: "Use GET or POST" });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Could not load presets" });
  }
};
