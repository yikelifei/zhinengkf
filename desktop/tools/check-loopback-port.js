"use strict";

const net = require("node:net");

const port = Number.parseInt(process.argv[2] || "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  process.exit(2);
}

const configuredTimeout = Number.parseInt(
  process.env.LOOPBACK_PORT_CHECK_TIMEOUT_MS || "750",
  10,
);
const timeoutMs =
  Number.isInteger(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 750;

const socket = net.createConnection({ host: "127.0.0.1", port });
let settled = false;

function finish(code) {
  if (settled) return;
  settled = true;
  socket.destroy();
  process.exit(code);
}

socket.setTimeout(timeoutMs);
socket.once("connect", () => finish(0));
socket.once("error", () => finish(1));
socket.once("timeout", () => finish(1));
