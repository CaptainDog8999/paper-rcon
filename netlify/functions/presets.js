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
  if (!res.ok) throw new Error(`Could not read saved servers (${res.status})`);
  return res.json();
}

async function blobSet(store, key, value) {
  const { url, token } = blobUrl(store, key);
  const res = await fetch(url, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`Could not save servers (${res.status})`);
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
    const session = token ? await blobGet("sessions", token) : null;
    if (!session || session.expires < Date.now()) return json(401, { message: "Sign in again." });
    if (event.httpMethod === "GET") {
      const saved = (await blobGet("server-presets", session.name)) || { presets: [] };
      return json(200, { name: session.name, presets: saved.presets || [] });
    }
    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const presets = cleanPresets(body.presets);
      await blobSet("server-presets", session.name, { presets });
      return json(200, { name: session.name, presets });
    }
    return json(405, { message: "Use GET or POST" });
  } catch (err) {
    return json(err.statusCode || 500, { message: err.message || "Could not load presets" });
  }
};
