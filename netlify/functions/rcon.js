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

function readPackets(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    const packets = [];
    const timer = setTimeout(() => {
      cleanup();
      resolve(packets);
    }, timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
    }
    function take() {
      while (buf.length >= 4) {
        const length = buf.readInt32LE(0);
        if (length < 10 || length > 1024 * 1024) {
          cleanup();
          reject(new Error("Bad RCON packet"));
          return;
        }
        if (buf.length < 4 + length) return;
        const body = buf.subarray(4, 4 + length);
        packets.push({
          id: body.readInt32LE(0),
          type: body.readInt32LE(4),
          payload: body.subarray(8, body.length - 2).toString("utf8"),
        });
        buf = buf.subarray(4 + length);
      }
    }
    function onData(chunk) {
      buf = Buffer.concat([buf, chunk]);
      take();
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function onEnd() {
      cleanup();
      resolve(packets);
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
        await wait(120);
        socket.write(packet(2, 2, command));
        socket.write(packet(3, 0, ""));
        const packets = await readPackets(socket, 2500);
        socket.end();
        if (packets.some((item) => item.id === -1)) {
          reject(new Error("RCON login failed. Check the password."));
          return;
        }
        const output = packets
          .filter((item) => item.id === 2)
          .map((item) => item.payload)
          .join("")
          .trim();
        resolve(output || "(no output)");
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
