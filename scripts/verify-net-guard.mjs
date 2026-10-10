// SSRF guard: addresses that must never be fetched, and addresses that must be.
import assert from "node:assert/strict";
import { isPrivateAddress, assertPublicUrl, safeFetchText } from "../api/_net.js";

const mustBlock = [
  "127.0.0.1", "127.1.2.3", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1",
  "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "fc00::1", "fd00::1", "fec0::1", "ff02::1",
  "::ffff:7f00:1", "::ffff:127.0.0.1", "::ffff:a9fe:a9fe", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::",
  "not-an-ip", "",
];
const mustAllow = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "2001:4860:4860::8888"];

for (const ip of mustBlock) assert.equal(isPrivateAddress(ip), true, `${ip || "(empty)"} should be blocked`);
for (const ip of mustAllow) assert.equal(isPrivateAddress(ip), false, `${ip} should be allowed`);

for (const url of ["http://localhost/", "http://127.0.0.1/", "http://[::1]/", "http://[::ffff:7f00:1]/", "http://169.254.169.254/latest/meta-data/",
  "http://metadata.internal/", "http://printer.local/", "ftp://example.com/", "file:///etc/passwd", "http://user:pw@example.com/"]) {
  await assert.rejects(() => assertPublicUrl(url), undefined, `assertPublicUrl should reject ${url}`);
}
// Literal-IP requests are refused before any socket is opened.
for (const url of ["http://127.0.0.1:9/", "http://[::ffff:7f00:1]:9/", "http://169.254.169.254/", "http://10.0.0.5/"]) {
  await assert.rejects(() => safeFetchText(url, { timeoutMs: 1500 }), /Private network|public website/, `safeFetchText should refuse ${url}`);
}
// A name that resolves to loopback is refused at connect time.
await assert.rejects(() => safeFetchText("http://localhost:9/", { timeoutMs: 1500 }), /public website/);
console.log("SSRF guard checks passed.");
