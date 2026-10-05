const { getStore } = require("@netlify/blobs");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
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
    const header = event.headers.authorization || event.headers.Authorization || "";
    const token = header.replace(/^Bearer\s+/i, "");
    const sessions = getStore("sessions");
    const session = token ? await sessions.get(token, { type: "json" }) : null;
    if (!session || session.expires < Date.now()) return json(401, { message: "Sign in again." });
    const presets = getStore("server-presets");
    if (event.httpMethod === "GET") {
      const saved = (await presets.get(session.name, { type: "json" })) || { presets: [] };
      return json(200, { name: session.name, presets: saved.presets || [] });
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const cleaned = cleanPresets(body.presets);
      await presets.setJSON(session.name, { presets: cleaned });
      return json(200, { name: session.name, presets: cleaned });
    }
    return json(405, { message: "Use GET or POST" });
  } catch (err) {
    return json(500, { message: err.message || "Could not load presets" });
  }
};
