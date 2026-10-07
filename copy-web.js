// Copies the web app (the same files GitHub Pages serves) into www/ for Capacitor.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const out = path.join(root, "www");
const files = ["index.html", "dashboard.html", "firebase-config.js"];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
console.log("Copied", files.join(", "), "to www/");
