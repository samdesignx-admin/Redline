// Functional checks of safeFetchText (redirects, gzip/brotli, size cap, timeout).
// The IP check is disabled in THIS process only, so a local test server can be
// reached; the guard itself is covered by verify-net-guard.mjs.
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import zlib from "node:zlib";

net.BlockList.prototype.check = () => false;
const { safeFetchText } = await import("../api/_net.js");

const server = http.createServer((req, res) => {
  const routes = {
    "/r1": () => { res.writeHead(302, { location: "/r2" }); res.end(); },
    "/r2": () => { res.writeHead(301, { location: "/final" }); res.end(); },
    "/loop": () => { res.writeHead(302, { location: "/loop" }); res.end(); },
    "/noloc": () => { res.writeHead(302); res.end(); },
    "/gzip": () => { res.writeHead(200, { "content-encoding": "gzip" }); res.end(zlib.gzipSync("<h1>héllo gzip</h1>")); },
    "/br": () => { res.writeHead(200, { "content-encoding": "br" }); res.end(zlib.brotliCompressSync("brotli ok")); },
    "/big": () => { res.writeHead(200); res.end("x".repeat(300_000)); },
    "/slow": () => {},
    "/404": () => { res.writeHead(404); res.end("nope"); },
  };
  (routes[req.url] || (() => { res.writeHead(200, { "content-type": "text/html" }); res.end("<p>final</p>"); }))();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

let r = await safeFetchText(`${base}/r1`);
assert.ok(r.ok && r.body === "<p>final</p>" && r.url.endsWith("/final"), "follows redirect chain");
assert.equal((await safeFetchText(`${base}/gzip`)).body, "<h1>héllo gzip</h1>");
assert.equal((await safeFetchText(`${base}/br`)).body, "brotli ok");
assert.equal((await safeFetchText(`${base}/big`, { maxBytes: 1000 })).body.length, 1000);
r = await safeFetchText(`${base}/404`);
assert.ok(r.status === 404 && r.ok === false);
await assert.rejects(() => safeFetchText(`${base}/loop`, { maxRedirects: 3 }), /Too many redirects/);
await assert.rejects(() => safeFetchText(`${base}/noloc`), /without a destination/);
await assert.rejects(() => safeFetchText(`${base}/slow`, { timeoutMs: 300 }), /timed out/);

server.closeAllConnections?.();
server.close();
console.log("Safe HTTP client checks passed.");
