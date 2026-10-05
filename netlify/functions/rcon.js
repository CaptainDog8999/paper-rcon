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

function varInt(value) {
  const bytes = [];
  let n = value >>> 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n) b |= 0x80;
    bytes.push(b);
  } while (n);
  return Buffer.from(bytes);
}

function minecraftPacket(id, data) {
  const body = Buffer.concat([varInt(id), data]);
  return Buffer.concat([varInt(body.length), body]);
}

function withSocket(host, port, run) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setNoDelay(true);
    socket.setTimeout(10000);
    const fail = (err) => {
      socket.destroy();
      reject(err);
    };
    socket.once("timeout", () => fail(new Error("Timed out reaching the Playit address")));
    socket.once("error", fail);
    socket.once("connect", () => run(socket).then(resolve).catch(fail));
  });
}

function readAvailable(socket, timeoutMs) {
  return new Promise((resolve) => {
    const chunks = [];
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("end", done);
      resolve(Buffer.concat(chunks));
    }
    function onData(chunk) {
      chunks.push(chunk);
    }
    socket.on("data", onData);
    socket.on("end", done);
  });
}

function decodePackets(buf) {
  const packets = [];
  let offset = 0;
  while (buf.length - offset >= 4) {
    const length = buf.readInt32LE(offset);
    if (length < 10 || length > 1024 * 1024 || buf.length - offset < 4 + length) break;
    const body = buf.subarray(offset + 4, offset + 4 + length);
    packets.push({
      id: body.readInt32LE(0),
      type: body.readInt32LE(4),
      payload: body.subarray(8, body.length - 2).toString("utf8"),
    });
    offset += 4 + length;
  }
  return packets;
}

async function looksLikeMinecraft(host, port) {
  try {
    return await withSocket(host, port, async (socket) => {
      const hostBuf = Buffer.from(host);
      const handshake = Buffer.concat([
        varInt(767),
        varInt(hostBuf.length),
        hostBuf,
        Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        varInt(1),
      ]);
      socket.write(minecraftPacket(0, handshake));
      socket.write(minecraftPacket(0, Buffer.alloc(0)));
      const bytes = await readAvailable(socket, 2500);
      socket.end();
      return bytes.length > 2;
    });
  } catch {
    return false;
  }
}

async function rconCommand(host, port, password, command) {
  return withSocket(host, port, async (socket) => {
    socket.write(packet(1, 3, password));
    let bytes = await readAvailable(socket, 5000);
    let packets = decodePackets(bytes);
    if (!packets.length) {
      const gamePort = await looksLikeMinecraft(host, port);
      if (gamePort) {
        throw new Error("That Playit port is the game join port, not RCON. Make a separate TCP tunnel to the RCON port and use the new public port.");
      }
      throw new Error("Playit stayed open, but Paper sent no RCON bytes. The local port on that tunnel has to be the rcon.port from server.properties.");
    }
    if (packets.some((item) => item.id === -1)) {
      throw new Error("RCON login failed. The password does not match rcon.password.");
    }
    socket.write(packet(2, 2, command));
    bytes = Buffer.concat([bytes, await readAvailable(socket, 5000)]);
    packets = decodePackets(bytes).filter((item) => item.id === 2);
    socket.end();
    return packets.map((item) => item.payload).join("").trim() || "(no output)";
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
  let host = String(body.ip || "").trim().replace(/^https?:\/\//, "").split("/")[0];
  let port = Number(body.port);
  if (host.includes(":")) {
    const split = host.split(":");
    host = split[0];
    if (!port) port = Number(split[1]);
  }
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
