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
  const token = process.env.BLOBS_TOKEN || "";
  if (!siteID || !token) {
    const missing = [!siteID ? "BLOBS_SITE_ID" : "", !token ? "BLOBS_TOKEN" : ""].filter(Boolean).join(" and ");
    const error = new Error(missing + " is missing. Leave Contains secret values unchecked, then redeploy.");
    error.statusCode = 500;
    throw error;
  }
  return getStore({ name, siteID, token });
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
    const sessions = openStore("sessions");
    const session = token ? await sessions.get(token, { type: "json" }) : null;
    if (!session || session.expires < Date.now()) return json(401, { message: "Sign in again." });
    const presets = openStore("server-presets");
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
