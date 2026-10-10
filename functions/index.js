// Dazift admin alerts: tell the platform admin by email and phone notification when
//  1) someone creates an owner account (even if they never confirm their email), and
//  2) a business is submitted and is waiting for approval.
// Deployed as its own codebase ("alerts"), so deploying it never touches the booking-alert functions.
// A product of LIT America (www.litamerica.net).
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { setGlobalOptions, logger } = require("firebase-functions/v2");
const { defineSecret, defineString } = require("firebase-functions/params");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

admin.initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 3 });

// The SMTP password is stored in Secret Manager: firebase functions:secrets:set SMTP_PASS
const SMTP_PASS = defineSecret("SMTP_PASS");
// Everything else has a default; change them in functions/.env if needed.
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtppro.zoho.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "465" });
const SMTP_USER = defineString("SMTP_USER", { default: "support@dazift.com" });
const ADMIN_EMAIL = defineString("ADMIN_EMAIL", { default: "samala_netha@yahoo.com" });
const APP_URL = "https://dazift.com/app";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (ms) => new Date(ms || Date.now()).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " CT";

async function sendEmail(subject, heading, rows, note) {
  const table = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#56706B;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#16302C"><b>${esc(v)}</b></td></tr>`).join("");
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#16302C">
    <div style="background:#1F7A69;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:20px;font-weight:800">Dazift</div>
    <div style="border:1px solid #E2E8E4;border-top:0;border-radius:0 0 12px 12px;padding:20px">
      <h2 style="margin:0 0 6px;font-size:20px">${esc(heading)}</h2>
      <p style="margin:0 0 14px;color:#56706B">${esc(note)}</p>
      <table style="border-collapse:collapse;font-size:15px">${table}</table>
      <p style="margin:20px 0 0"><a href="${APP_URL}" style="background:#F2C230;color:#2A2305;padding:10px 18px;border-radius:999px;font-weight:800;text-decoration:none">Open Platform Admin</a></p>
      <p style="margin:22px 0 0;font-size:12px;color:#8A9B97">Dazift · A product of <a href="https://www.litamerica.net" style="color:#8A9B97">LIT America</a></p>
    </div></div>`;
  const text = `${heading}\n${note}\n\n` + rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nOpen Platform Admin: ${APP_URL}`;
  const port = Number(SMTP_PORT.value()) || 465;
  const transport = nodemailer.createTransport({ host: SMTP_HOST.value(), port, secure: port === 465, auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() } });
  await transport.sendMail({ from: `Dazift <${SMTP_USER.value()}>`, to: ADMIN_EMAIL.value(), subject, text, html });
}

// Push to every phone the admin is signed in on (the app saves those in the "devices" collection).
async function sendPush(title, body) {
  const snap = await admin.firestore().collection("devices").where("email", "==", ADMIN_EMAIL.value().toLowerCase()).get();
  const tokens = snap.docs.map((d) => d.id).filter(Boolean);
  if (!tokens.length) { logger.info("No admin phone registered for push"); return; }
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { kind: "admin_alert" },
    android: { priority: "high", notification: { channelId: "bookings", sound: "default" } },
    apns: { payload: { aps: { sound: "default" } } },
  });
  // Forget phones that no longer accept notifications.
  await Promise.all(res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error && r.error.code || ""))
    ? admin.firestore().doc("devices/" + tokens[i]).delete().catch(() => {}) : null));
}

async function alertAdmin(subject, heading, rows, note, pushTitle, pushBody) {
  const results = await Promise.allSettled([sendEmail(subject, heading, rows, note), sendPush(pushTitle, pushBody)]);
  results.forEach((r, i) => { if (r.status === "rejected") logger.error(i === 0 ? "Email failed" : "Push failed", r.reason); });
}

// 1) Someone created an owner account on the Register form.
exports.notifyNewSignup = onDocumentCreated({ document: "crewAccounts/{uid}", secrets: [SMTP_PASS] }, async (event) => {
  const a = event.data && event.data.data(); if (!a || a.role !== "owner") return;   // crew sign-ups don't need an alert
  const biz = a.plannedBusinessName || "a new business";
  await alertAdmin(
    `New Dazift sign-up: ${biz}`, "New sign-up",
    [["Business", a.plannedBusinessName], ["Type", a.plannedCategory], ["Name", a.name], ["Email", a.email], ["Phone", a.phone], ["Signed up", when(a.createdAt)]],
    "They still need to confirm their email and submit the business. If they don't, it'll show under \"Signed up, no business yet\" in Platform Admin.",
    "New sign-up: " + biz, [a.name, a.plannedCategory, a.phone || a.email].filter(Boolean).join(" · "));
});

// 2) A business was submitted and is waiting for approval.
exports.notifyBusinessPending = onDocumentCreated({ document: "businesses/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const b = event.data && event.data.data(); if (!b || b.status !== "pending") return;   // businesses you pre-register start active
  const place = [b.city, b.state].filter(Boolean).join(", ");
  await alertAdmin(
    `Approve on Dazift: ${b.name || "new business"}`, "A business is waiting for your approval",
    [["Business", b.name], ["Type", b.category], ["Location", place], ["Phone", b.phone], ["Business email", b.email], ["Owner email", (b.ownerEmails || [])[0]], ["About", b.description], ["Submitted", when(b.createdAt)]],
    "They can't use Dazift until you approve them in Platform Admin.",
    "Approve: " + (b.name || "new business"), [b.category, place].filter(Boolean).join(" · ") || "Waiting for your approval");
});
