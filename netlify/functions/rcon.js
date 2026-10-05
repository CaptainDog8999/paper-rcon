const net = require("net");

const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*(?:ply\.gg|playit\.gg|playit\.plus|joinmc\.link)$/i;

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(payload),
  };
}

function packet(id, type, payload) {
  const text = Buffer.from(payload, "utf8");
  const body = Buffer.alloc(10 + text.length);
  body.writeInt32LE(id, 0);
  body.writeInt32LE(type, 4);
  text.copy(body, 8);
  const frame = Buffer.alloc(4 + body.length);
  frame.writeInt32LE(body.length, 0);
  body.copy(frame, 4);
  return frame;
}

function readOne(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("Playit connected, but Paper sent no RCON reply. Use a TCP tunnel to 127.0.0.1 and the RCON port, turn proxy protocol off, and enter the public port Playit shows.")), null);
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    }
    function finish(err, value) {
      cleanup();
      if (err) reject(err);
      else resolve(value);
    }
    function take() {
      if (buf.length < 4) return;
      const length = buf.readInt32LE(0);
      if (length < 10 || length > 1024 * 1024) {
        finish(new Error("Bad RCON packet"));
        return;
      }
      if (buf.length < 4 + length) return;
      const body = buf.subarray(4, 4 + length);
      buf = buf.subarray(4 + length);
      finish(null, {
        id: body.readInt32LE(0),
        type: body.readInt32LE(4),
        payload: body.subarray(8, body.length - 2).toString("utf8"),
        rest: buf,
      });
    }
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      take();
    }
    function onError(err) {
      finish(err);
    }
    function onEnd() {
      finish(new Error("Paper closed the RCON connection. Check the password, enable-rcon=true, and that the Playit local port is the RCON port."));
    }
    socket.on("data", onData);
    socket.on("error", onError);
    socket.on("end", onEnd);
  });
}

function rconCommand(host, port, password, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(8000);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Timed out reaching the Playit address"));
    });
    socket.once("error", reject);
    socket.once("connect", async () => {
      try {
        socket.write(packet(1, 3, password));
        const auth = await readOne(socket, 4000);
        if (auth.id === -1) {
          socket.end();
          reject(new Error("RCON login failed. Check the password."));
          return;
        }
        socket.write(packet(2, 2, command));
        const reply = await readOne(socket, 4000);
        socket.end();
        if (reply.id === -1) {
          reject(new Error("RCON login failed. Check the password."));
          return;
        }
        resolve(reply.payload.trim() || "(no output)");
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
  });
}

exports.handler = async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { message: "Use POST" });
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { message: "Bad request" });
  }
  const host = String(body.ip || "").trim().replace(/^https?:\/\//, "").split("/")[0];
  const port = Number(body.port);
  const password = String(body.password || "");
  const command = String(body.command || "").trim();
  if (!ALLOWED_HOST.test(host)) {
    return json(400, { message: "IP must be a Playit address, such as name.gl.at.ply.gg" });
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return json(400, { message: "RCON port is not valid" });
  }
  if (!password || !command || command.length > 400) {
    return json(400, { message: "Password and a short command are required" });
  }
  try {
    const output = await rconCommand(host, port, password, command);
    return json(200, { output });
  } catch (err) {
    return json(502, { message: err.message || "Could not reach RCON" });
  }
};
