import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Source-level guard only: isolated mocked API and UI tests remain required.
const src = readFileSync(new URL("../api/account.js", import.meta.url), "utf8");
const between = (start, end) => {
  const section = src.split(start)[1]?.split(end)[0];
  assert.ok(section, `Missing handler section: ${start}`);
  return section;
};
const session = between('if (action === "session") {', '/* ---------------- Sign up');
const signup = between('if (action === "signup") {', '/* ---------------- Log in');
const login = between('if (action === "login") {', '/* ---------------- Google sign-in');
assert.match(session, /data\?\.email_verified === true \? publicAccount\(data\) : null/, "Unverified sessions must not restore");
assert.match(signup, /email_verified:\s*false/, "Signup must not trust client verification");
assert.doesNotMatch(signup, /token:\s*issueSession/, "Signup must not issue an authenticated session");
assert.match(login, /data\.email_verified !== true/, "Login must require verified email");
assert.match(login, /status\(403\)/, "Unverified login must be rejected");
console.log("PASS: static verified-email session guards");
