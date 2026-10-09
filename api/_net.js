// SSRF-safe HTTP helpers for fetching user-supplied URLs.
//
// Checking a hostname once and then calling fetch() is not enough: fetch
// resolves DNS again (DNS rebinding), follows redirects to addresses nobody
// checked, and IPv6 has many spellings of "localhost". Here every connection
// is validated at connect time, on the very lookup that is used to connect,
// and every redirect hop goes through the same guard.

import dns from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
]) blocked.addSubnet(addr, prefix, "ipv4");
for (const [addr, prefix] of [
  ["::", 128], ["::1", 128],
  // IPv4-mapped addresses (::ffff:127.0.0.1) need no rule of their own: Node's
  // BlockList matches them against the IPv4 rules above. Adding ::ffff:0:0/96
  // would wrongly block every IPv4 address, because IPv4 is matched as mapped IPv6.
  ["64:ff9b::", 96],    // NAT64
  ["64:ff9b:1::", 48],
  ["100::", 64],        // discard-only
  ["2001::", 32],       // Teredo
  ["2001:db8::", 32],   // documentation
  ["2002::", 16],       // 6to4
  ["fc00::", 7],        // unique local
  ["fe80::", 10],       // link local
  ["fec0::", 10],       // site local (deprecated)
  ["ff00::", 8],        // multicast
]) blocked.addSubnet(addr, prefix, "ipv6");

// True for anything that is not a plain public unicast address. Unparseable
// input is treated as private.
export function isPrivateAddress(address) {
  const value = String(address || "").replace(/^\[|\]$/g, "").split("%")[0];
  const family = net.isIP(value);
  if (!family) return true;
  return blocked.check(value, family === 4 ? "ipv4" : "ipv6");
}

function blockedError() {
  const err = new Error("This address does not resolve to a public website.");
  err.code = "EBLOCKED";
  return err;
}

// Drop-in replacement for dns.lookup used by http(s).request: resolves, then
// refuses to connect if ANY returned address is non-public.
function guardedLookup(hostname, options, callback) {
  if (typeof options === "function") { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: net.isIP(addresses) }];
    if (!list.length || list.some((entry) => isPrivateAddress(entry.address))) return callback(blockedError());
    if (options && options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

// Validates syntax and (best effort, early) DNS. Used before handing a URL to
// a third-party fetcher, and as a cheap up-front rejection. The connect-time
// guard in safeRequest is the one that actually closes the rebinding gap.
export async function assertPublicUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only public http and https URLs are supported.");
  if (url.username || url.password) throw new Error("URLs with embedded credentials are not supported.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Local addresses are not supported.");
  }
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private network addresses are not supported.");
    return url;
  }
  const addresses = await dnsLookup(host, { all: true });
  if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("This address does not resolve to a public website.");
  return url;
}

function decoder(res) {
  const encoding = String(res.headers["content-encoding"] || "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

// One HTTP(S) request with no automatic redirects. Resolves to
// { status, headers, body, url } with `body` capped at maxBytes.
export function safeRequest(urlString, { headers = {}, timeoutMs = 8000, maxBytes = 1_500_000 } = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(urlString); } catch (e) { reject(e); return; }
    if (!["http:", "https:"].includes(url.protocol)) { reject(new Error("Only public http and https URLs are supported.")); return; }
    if (url.username || url.password) { reject(new Error("URLs with embedded credentials are not supported.")); return; }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    // IP literals skip DNS entirely, so the lookup guard never sees them.
    if (net.isIP(host) && isPrivateAddress(host)) { reject(new Error("Private network addresses are not supported.")); return; }

    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET",
      lookup: guardedLookup,
      headers: { "accept-encoding": "gzip, deflate, br", ...headers },
    }, (res) => {
      const status = res.statusCode || 0;
      const outHeaders = res.headers;
      if (status >= 300 && status < 400) {
        res.resume();
        finish(resolve, { status, headers: outHeaders, body: "", url: url.toString() });
        return;
      }
      const stream = decoder(res);
      const chunks = [];
      let size = 0;
      stream.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (size - maxBytes))));
          finish(resolve, { status, headers: outHeaders, body: Buffer.concat(chunks).toString("utf8"), url: url.toString() });
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => finish(resolve, { status, headers: outHeaders, body: Buffer.concat(chunks).toString("utf8"), url: url.toString() }));
      stream.on("error", (err) => finish(reject, err));
      res.on("error", (err) => finish(reject, err));
    });
    const timer = setTimeout(() => { req.destroy(); finish(reject, new Error("The request timed out.")); }, timeoutMs);
    req.on("error", (err) => finish(reject, err));
    req.end();
  });
}

// GET that follows redirects manually, running every hop through the guard.
export async function safeFetchText(urlString, { maxRedirects = 5, ...options } = {}) {
  let current = urlString;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await safeRequest(current, options);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location) throw new Error("The website redirected without a destination.");
      current = new URL(location, current).toString();
      continue;
    }
    return { ...response, url: current, ok: response.status >= 200 && response.status < 300 };
  }
  throw new Error("Too many redirects.");
}
