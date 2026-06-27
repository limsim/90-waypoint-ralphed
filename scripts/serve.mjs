// Minimal static file server for local development.
// Zero dependencies (node: built-ins only). Serves the project root so that
// index.html and the compiled ES modules under dist/ are reachable.
//
// Listens on port 8000 and auto-increments to the next free port if taken.
// Usage: node scripts/serve.mjs   (wired as `npm run serve`)

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const START_PORT = 8000;
const MAX_PORT_ATTEMPTS = 100;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/** Resolve a request URL to an absolute path inside ROOT, or null if it escapes. */
function resolveRequestPath(requestUrl) {
  const { pathname } = new URL(requestUrl, "http://localhost");
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) {
    return null; // path traversal attempt
  }
  return candidate;
}

const server = createServer(async (req, res) => {
  const requested = resolveRequestPath(req.url ?? "/");
  if (requested === null) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403 Forbidden");
    return;
  }

  let filePath = requested;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
      await stat(filePath);
    }
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 Not Found");
    return;
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": contentType });
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });
  stream.pipe(res);
});

function listen(port, attemptsLeft) {
  const onListening = () => {
    server.removeListener("error", onError);
    const address = server.address();
    const boundPort = address && typeof address === "object" ? address.port : port;
    console.log(`Serving ${ROOT}`);
    console.log(`  http://localhost:${boundPort}/`);
    console.log("Press Ctrl+C to stop.");
  };
  const onError = (err) => {
    server.removeListener("listening", onListening);
    if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
    } else {
      console.error(err);
      process.exit(1);
    }
  };
  server.once("listening", onListening);
  server.once("error", onError);
  server.listen(port);
}

listen(START_PORT, MAX_PORT_ATTEMPTS);
