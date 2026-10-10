// Dazift email: admin alerts, plus invoices and overdue reminders for every business.
// Admin alerts tell the platform admin by email and phone notification when
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

// ---------- Invoices ----------
// The app drops a request in "mail" when an owner taps "Send email"; this sends the invoice link
// to the client from "<Business> via Dazift", with replies going to the business.
// Dazift never takes payments: "Pay online" is the business's own payment link.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const INVOICE_BASE = "https://dazift.com/invoice.html?k=";
const money = (n) => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const niceDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" }); };
const todayCT = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
const okEmail = (s) => typeof s === "string" && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s) && s.length < 200;

function transport() {
  const port = Number(SMTP_PORT.value()) || 465;
  return nodemailer.createTransport({ host: SMTP_HOST.value(), port, secure: port === 465, auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() } });
}

function invoiceEmail(p, key, reminder) {
  const b = p.biz || {}, url = INVOICE_BASE + key, due = Number(p.dueNowBal) || 0;
  const first = String((p.client && p.client.name) || "").split(" ")[0] || "there";
  const dueText = p.terms === "Due on receipt" ? "due on receipt" : "due " + niceDate(p.dueDate);
  const subject = reminder
    ? `Reminder: invoice ${p.number} from ${b.name} is past due`
    : `Invoice ${p.number} from ${b.name}: ${money(due)} ${dueText}`;
  const intro = reminder
    ? `Just a friendly reminder that invoice ${p.number} for ${money(due)} was ${dueText}. If you've already paid, thank you, and please ignore this note.`
    : `Thank you for your business. Here's invoice ${p.number} for ${money(due)}, ${dueText}.`;
  const pay = p.payLink && /^https:\/\//i.test(p.payLink)
    ? `<a href="${esc(p.payLink)}" style="display:inline-block;background:#D9480F;color:#fff;padding:11px 20px;border-radius:999px;font-weight:800;text-decoration:none;margin:0 8px 8px 0">Pay online</a>` : "";
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1D1B18">
    <div style="padding:18px 0 8px;font-size:22px;font-weight:800">${esc(b.name)}</div>
    <div style="border:1px solid #E3E0D9;border-radius:12px;padding:22px">
      <p style="margin:0 0 14px">Hi ${esc(first)},</p>
      <p style="margin:0 0 16px">${esc(intro)}</p>
      <table style="border-collapse:collapse;font-size:15px;margin:0 0 18px">
        <tr><td style="padding:4px 18px 4px 0;color:#6A655D">Invoice</td><td><b>${esc(p.number)}</b></td></tr>
        <tr><td style="padding:4px 18px 4px 0;color:#6A655D">Amount due</td><td><b>${esc(money(due))}</b></td></tr>
        <tr><td style="padding:4px 18px 4px 0;color:#6A655D">Due</td><td><b>${esc(p.terms === "Due on receipt" ? "On receipt" : niceDate(p.dueDate))}</b></td></tr>
      </table>
      ${pay}<a href="${esc(url)}" style="display:inline-block;background:#F2C230;color:#2A2305;padding:11px 20px;border-radius:999px;font-weight:800;text-decoration:none;margin:0 0 8px">View invoice</a>
      ${p.payNote ? `<p style="margin:16px 0 0;color:#1D1B18"><b>How to pay:</b> ${esc(p.payNote)}</p>` : ""}
      <p style="margin:18px 0 0;color:#6A655D;font-size:14px">Questions? Reply to this email${b.phone ? " or call " + esc(b.phone) : ""}.</p>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8A8278;text-align:center">Sent with Dazift for ${esc(b.name)} · A product of <a href="https://www.litamerica.net" style="color:#8A8278">LIT America</a></p></div>`;
  const text = `Hi ${first},\n\n${intro}\n\nView invoice: ${url}\n` + (p.payLink ? `Pay online: ${p.payLink}\n` : "") + (p.payNote ? `How to pay: ${p.payNote}\n` : "")
    + `\nQuestions? Reply to this email${b.phone ? " or call " + b.phone : ""}.\n\n${b.name}\nSent with Dazift · A product of LIT America`;
  return { subject, html, text };
}

async function mailInvoice(p, key, to, reminder) {
  const b = p.biz || {};
  const name = String(b.name || "Dazift").replace(/["<>\r\n]/g, "").slice(0, 80);
  const msg = invoiceEmail(p, key, reminder);
  await transport().sendMail({ from: `"${name} via Dazift" <${SMTP_USER.value()}>`, to, replyTo: okEmail(b.email) ? b.email : undefined, ...msg });
}

exports.sendInvoiceEmail = onDocumentCreated({ document: "mail/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const ref = event.data && event.data.ref, m = event.data && event.data.data();
  if (!m || m.kind !== "invoice") return;
  const fail = (why) => { logger.warn("Invoice email not sent", why); return ref.update({ status: "error", error: why, doneAt: Date.now() }); };
  try {
    if (!okEmail(m.to)) return fail("bad address");
    const db = admin.firestore();
    const [bizSnap, invSnap] = await Promise.all([db.doc("businesses/" + m.businessId).get(), db.doc("invoices/" + m.invoiceId).get()]);
    const biz = bizSnap.data(), inv = invSnap.data();
    if (!biz || biz.status !== "active") return fail("business not active");
    if (!(biz.ownerUids || []).includes(m.createdBy)) return fail("not an owner");
    if (!inv || inv.businessId !== m.businessId || !inv.publicKey || inv.publicKey !== m.key) return fail("invoice not found");
    // Keep a lid on volume so a business can't be used to spam.
    // (one range filter only, so no extra database index is needed)
    const recent = await db.collection("mail").where("createdAt", ">", Date.now() - 864e5).select("businessId").get();
    if (recent.docs.filter((x) => x.get("businessId") === m.businessId).length > 60) return fail("daily limit reached");
    const pub = (await db.doc("publicInvoices/" + inv.publicKey).get()).data();
    if (!pub || pub.status === "void") return fail("invoice void");
    await mailInvoice(pub, inv.publicKey, m.to, false);
    await Promise.all([ref.update({ status: "sent", doneAt: Date.now() }), invSnap.ref.update({ lastEmailAt: Date.now(), sentVia: "email" })]);
  } catch (e) { logger.error("Invoice email failed", e); await ref.update({ status: "error", error: String(e && e.message || e).slice(0, 300), doneAt: Date.now() }).catch(() => {}); }
});

// Every morning: a friendly reminder for invoices that are past due, every 3 days, up to 3 times.
exports.invoiceReminders = onSchedule({ schedule: "every day 09:00", timeZone: "America/Chicago", secrets: [SMTP_PASS] }, async () => {
  const db = admin.firestore(), today = todayCT(), now = Date.now();
  const snap = await db.collection("invoices").where("open", "==", true).where("autoRemind", "==", true).get();
  let sent = 0;
  for (const d of snap.docs) {
    const inv = d.data();
    if (sent >= 200) break;
    if (!inv.dueDate || inv.dueDate >= today || !(Number(inv.dueNowBal) > 0) || !inv.publicKey) continue;
    if ((inv.reminders || 0) >= 3 || (inv.lastReminderAt && now - inv.lastReminderAt < 3 * 864e5 - 36e5)) continue;
    const to = inv.client && inv.client.email; if (!okEmail(to)) continue;
    try {
      const biz = (await db.doc("businesses/" + inv.businessId).get()).data(); if (!biz || biz.status !== "active") continue;
      const pub = (await db.doc("publicInvoices/" + inv.publicKey).get()).data(); if (!pub || pub.status !== "open") continue;
      await mailInvoice(pub, inv.publicKey, to, true);
      await d.ref.update({ reminders: (inv.reminders || 0) + 1, lastReminderAt: now });
      sent++;
    } catch (e) { logger.error("Reminder failed for " + d.id, e); }
  }
  logger.info("Invoice reminders sent: " + sent);
});
