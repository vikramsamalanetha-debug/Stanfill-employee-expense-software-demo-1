// Copies the web app (the same files GitHub Pages serves) into www/ for Capacitor.
// The phone app opens straight into the portal, so app.html becomes www/index.html.
// The public homepage (index.html) is website-only and is not bundled.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const files = [
  ["app.html", "index.html"],
  ["dashboard.html", "dashboard.html"],
  ["firebase-config.js", "firebase-config.js"],
  ["favicon.svg", "favicon.svg"],
];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const [from, to] of files) {
  const src = path.join(root, from);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, to));
}
const sounds = path.join(root, "sounds");
if (fs.existsSync(sounds)) fs.cpSync(sounds, path.join(out, "sounds"), { recursive: true });
console.log("Copied web app into www/ (app.html -> index.html)");
