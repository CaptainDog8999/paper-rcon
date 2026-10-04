const { getStore } = require("@netlify/blobs");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

async function accountName(event) {
  const header = event.headers.authorization || event.headers.Authorization || "";
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) {
    const error = new Error("Sign in first.");
    error.statusCode = 401;
    throw error;
  }
  const sessions = getStore("sessions");
  const session = await sessions.get(token, { type: "json" });
  if (!session || session.expires < Date.now()) {
    const error = new Error("Sign in again.");
    error.statusCode = 401;
    throw error;
  }
  return session.name;
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
    const name = await accountName(event);
    const store = getStore("server-presets");
    if (event.httpMethod === "GET") {
      const saved = (await store.get(name, { type: "json" })) || { presets: [] };
      return json(200, { name, presets: saved.presets || [] });
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const presets = cleanPresets(body.presets);
      await store.setJSON(name, { presets });
      return json(200, { name, presets });
    }
    return json(405, { message: "Use GET or POST" });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Could not load presets" });
  }
};
