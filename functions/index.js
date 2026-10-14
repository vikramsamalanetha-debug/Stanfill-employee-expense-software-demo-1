// Dayzift email: admin alerts, booking requests (owners and customers), plus invoices and overdue reminders for every business.
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

// All Dayzift email (alerts, bookings, invoices) is sent from the LIT America Yahoo account.
// The password is a Yahoo *app password*, stored in Secret Manager: firebase functions:secrets:set SMTP_PASS
// (Yahoo only lets an account send as itself, so emails always come from SMTP_USER.)
const SMTP_PASS = defineSecret("SMTP_PASS");
// Everything else has a default; change them in functions/.env.stanfill-clean-pros if needed.
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.mail.yahoo.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "465" });
const SMTP_USER = defineString("SMTP_USER", { default: "litamerica@yahoo.com" });
// Who gets the admin alerts (new sign-ups, businesses waiting for approval). Separate several with commas.
const ADMIN_EMAILS = defineString("ADMIN_EMAILS", { default: "samala_netha@yahoo.com, dayzift@yahoo.com" });
const adminList = () => ADMIN_EMAILS.value().split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
const APP_URL = "https://dayzift.com/app";

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const when = (ms) => new Date(ms || Date.now()).toLocaleString("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }) + " CT";

async function sendEmail(subject, heading, rows, note) {
  const table = rows.filter(([, v]) => v).map(([k, v]) =>
    `<tr><td style="padding:6px 14px 6px 0;color:#56706B;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0;color:#16302C"><b>${esc(v)}</b></td></tr>`).join("");
  const html = `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#16302C">
    <div style="background:#1F7A69;color:#fff;padding:16px 20px;border-radius:12px 12px 0 0;font-size:20px;font-weight:800">Dayzift</div>
    <div style="border:1px solid #E2E8E4;border-top:0;border-radius:0 0 12px 12px;padding:20px">
      <h2 style="margin:0 0 6px;font-size:20px">${esc(heading)}</h2>
      <p style="margin:0 0 14px;color:#56706B">${esc(note)}</p>
      <table style="border-collapse:collapse;font-size:15px">${table}</table>
      <p style="margin:20px 0 0"><a href="${APP_URL}" style="background:#F2C230;color:#2A2305;padding:10px 18px;border-radius:999px;font-weight:800;text-decoration:none">Open Platform Admin</a></p>
      <p style="margin:22px 0 0;font-size:12px;color:#8A9B97">Dayzift · A product of <a href="https://www.litamerica.net" style="color:#8A9B97">LIT America</a></p>
    </div></div>`;
  const text = `${heading}\n${note}\n\n` + rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n") + `\n\nOpen Platform Admin: ${APP_URL}`;
  const port = Number(SMTP_PORT.value()) || 465;
  const transport = nodemailer.createTransport({ host: SMTP_HOST.value(), port, secure: port === 465, auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() } });
  await transport.sendMail({ from: `Dayzift <${SMTP_USER.value()}>`, to: adminList().join(", "), subject, text, html });
}

// Push to every phone the admin is signed in on (the app saves those in the "devices" collection).
async function sendPush(title, body) {
  const snap = await admin.firestore().collection("devices").where("email", "in", adminList().slice(0, 10)).get();
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
    `New Dayzift sign-up: ${biz}`, "New sign-up",
    [["Business", a.plannedBusinessName], ["Type", a.plannedCategory], ["Name", a.name], ["Email", a.email], ["Phone", a.phone], ["Signed up", when(a.createdAt)]],
    "They still need to confirm their email and submit the business. If they don't, it'll show under \"Signed up, no business yet\" in Platform Admin.",
    "New sign-up: " + biz, [a.name, a.plannedCategory, a.phone || a.email].filter(Boolean).join(" · "));
});

// 2) A business was submitted and is waiting for approval.
exports.notifyBusinessPending = onDocumentCreated({ document: "businesses/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const b = event.data && event.data.data(); if (!b || b.status !== "pending") return;   // businesses you pre-register start active
  const place = [b.city, b.state].filter(Boolean).join(", ");
  await alertAdmin(
    `Approve on Dayzift: ${b.name || "new business"}`, "A business is waiting for your approval",
    [["Business", b.name], ["Type", b.category], ["Location", place], ["Phone", b.phone], ["Business email", b.email], ["Owner email", (b.ownerEmails || [])[0]], ["About", b.description], ["Submitted", when(b.createdAt)]],
    "They can't use Dayzift until you approve them in Platform Admin.",
    "Approve: " + (b.name || "new business"), [b.category, place].filter(Boolean).join(" · ") || "Waiting for your approval");
});

// ---------- Invoices ----------
// The app drops a request in "mail" when an owner taps "Send email"; this sends the invoice link
// to the client from "<Business> via Dayzift", with replies going to the business.
// Dayzift never takes payments: "Pay online" is the business's own payment link.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const INVOICE_BASE = "https://dayzift.com/invoice.html?k=";
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
    <p style="margin:16px 0 0;font-size:12px;color:#8A8278;text-align:center">Sent with Dayzift for ${esc(b.name)} · A product of <a href="https://www.litamerica.net" style="color:#8A8278">LIT America</a></p></div>`;
  const text = `Hi ${first},\n\n${intro}\n\nView invoice: ${url}\n` + (p.payLink ? `Pay online: ${p.payLink}\n` : "") + (p.payNote ? `How to pay: ${p.payNote}\n` : "")
    + `\nQuestions? Reply to this email${b.phone ? " or call " + b.phone : ""}.\n\n${b.name}\nSent with Dayzift · A product of LIT America`;
  return { subject, html, text };
}

async function mailInvoice(p, key, to, reminder) {
  const b = p.biz || {};
  const name = String(b.name || "Dayzift").replace(/["<>\r\n]/g, "").slice(0, 80);
  const msg = invoiceEmail(p, key, reminder);
  await transport().sendMail({ from: `"${name} via Dayzift" <${SMTP_USER.value()}>`, to, replyTo: okEmail(b.email) ? b.email : undefined, ...msg });
}

// Same rule as the app: only businesses waiting for approval or suspended are blocked.
// Businesses created before approvals existed have no status, and they are active.
const bizOpen = (b) => !!b && b.status !== "pending" && b.status !== "suspended";

exports.sendInvoiceEmail = onDocumentCreated({ document: "mail/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const ref = event.data && event.data.ref, m = event.data && event.data.data();
  if (!m || m.kind !== "invoice") return;
  const fail = (why) => { logger.warn("Invoice email not sent", why); return ref.update({ status: "error", error: why, doneAt: Date.now() }); };
  try {
    if (!okEmail(m.to)) return fail("bad address");
    const db = admin.firestore();
    const [bizSnap, invSnap] = await Promise.all([db.doc("businesses/" + m.businessId).get(), db.doc("invoices/" + m.invoiceId).get()]);
    const biz = bizSnap.data(), inv = invSnap.data();
    if (!bizOpen(biz)) return fail("business not active");
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
      const biz = (await db.doc("businesses/" + inv.businessId).get()).data(); if (!bizOpen(biz)) continue;
      const pub = (await db.doc("publicInvoices/" + inv.publicKey).get()).data(); if (!pub || pub.status !== "open") continue;
      await mailInvoice(pub, inv.publicKey, to, true);
      await d.ref.update({ reminders: (inv.reminders || 0) + 1, lastReminderAt: now });
      sent++;
    } catch (e) { logger.error("Reminder failed for " + d.id, e); }
  }
  logger.info("Invoice reminders sent: " + sent);
});

// ---------- Booking requests ----------
// A customer sends a request from a business's website (the "bookings" collection). Then:
//  1) the business's owners (or the alert emails set in Settings → Notifications) get an email
//     with Approve / Decline buttons, plus a phone alert on every owner phone;
//  2) the customer gets a "we received your request" email;
//  3) owners get a reminder every 2 hours (daytime, Central), up to 3 times, until someone answers;
//  4) when the request is approved or declined (in the app or from the email), the customer is emailed.
// Emails come from "<Business>" <litamerica@yahoo.com>; replies go to the business / the customer.
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const crypto = require("crypto");
const PROJECT = process.env.GCLOUD_PROJECT || "stanfill-clean-pros";
const ACTION_URL = `https://us-central1-${PROJECT}.cloudfunctions.net/bookingAction`;
const REQUESTS_URL = "https://dayzift.com/app";

const bizLabel = (b) => String((b && b.name) || "Dayzift").replace(/["<>\r\n]/g, "").slice(0, 80);
const reqDay = (iso) => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? String(iso).slice(0, 10)
  : d.toLocaleDateString("en-US", { timeZone: "America/Chicago", weekday: "long", month: "long", day: "numeric", year: "numeric" }); };
const firstName = (n) => String(n || "").trim().split(/\s+/)[0] || "there";

// Who hears about new requests: the alert emails set in Settings, otherwise every owner.
async function ownerEmailsFor(biz) {
  const set = new Set();
  const custom = (biz.notifyEmails || []).filter(okEmail);
  if (custom.length) custom.forEach((e) => set.add(e.toLowerCase()));
  else {
    (biz.ownerEmails || []).filter(okEmail).forEach((e) => set.add(e.toLowerCase()));
    const uids = (biz.ownerUids || (biz.ownerUid ? [biz.ownerUid] : [])).filter(Boolean).slice(0, 10);
    const users = await Promise.allSettled(uids.map((u) => admin.auth().getUser(u)));
    users.forEach((r) => { if (r.status === "fulfilled" && okEmail(r.value.email)) set.add(r.value.email.toLowerCase()); });
  }
  return [...set].slice(0, 10);
}

// The customer's email: their sign-in email, their profile, or what they typed in "Phone or email".
async function customerEmailFor(bk) {
  if (bk.uid) {
    try { const u = await admin.auth().getUser(bk.uid); if (okEmail(u.email)) return u.email; } catch (e) { /* no such user */ }
    try { const c = (await admin.firestore().doc("customers/" + bk.uid).get()).data(); if (c && okEmail(c.email)) return c.email; } catch (e) { /* ignore */ }
  }
  return okEmail(bk.email) ? bk.email : okEmail(String(bk.phone || "").trim()) ? String(bk.phone).trim() : null;
}

function bookingRows(bk, b) {
  return [["Service", bk.service], ["Date wanted", reqDay(bk.requestedDate)], ["Name", bk.name], ["Contact", bk.phone],
    ["Details", bk.details], ["Rewards", bk.wantsRewards ? "Wants to join " + ((b && b.rewardsName) || "rewards") : ""]]
    .filter(([, v]) => v);
}
const rowsHtml = (rows) => `<table style="border-collapse:collapse;font-size:15px;margin:0 0 18px">${rows.map(([k, v]) =>
  `<tr><td style="padding:5px 16px 5px 0;color:#6A655D;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:5px 0"><b>${esc(v)}</b></td></tr>`).join("")}</table>`;
const btn = (href, label, bg, fg) => `<a href="${esc(href)}" style="display:inline-block;background:${bg};color:${fg};padding:11px 20px;border-radius:999px;font-weight:800;text-decoration:none;margin:0 8px 8px 0">${esc(label)}</a>`;
const shell = (title, inner, footer) => `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1D1B18">
  <div style="padding:18px 0 8px;font-size:22px;font-weight:800">${esc(title)}</div>
  <div style="border:1px solid #E3E0D9;border-radius:12px;padding:22px">${inner}</div>
  <p style="margin:16px 0 0;font-size:12px;color:#8A8278;text-align:center">${footer} · A product of <a href="https://www.litamerica.net" style="color:#8A8278">LIT America</a></p></div>`;

async function emailOwners(bookingId, bk, biz, key, reminderNo) {
  const to = await ownerEmailsFor(biz);
  if (!to.length) { logger.warn("No owner email for booking " + bookingId); return false; }
  const cust = await customerEmailFor(bk);
  const link = (a) => `${ACTION_URL}?id=${encodeURIComponent(bookingId)}&k=${key}&a=${a}`;
  const day = reqDay(bk.requestedDate);
  const subject = (reminderNo ? `Reminder: ` : `New booking request: `) + `${bk.service || "Service"}${day ? ", " + day : ""} (${bk.name || "customer"})`;
  const lead = reminderNo
    ? `This request is still waiting for an answer (reminder ${reminderNo} of 3).`
    : `You have a new booking request from your website.`;
  const rows = bookingRows(bk, biz);
  const html = shell(bizLabel(biz), `<p style="margin:0 0 16px">${esc(lead)}</p>${rowsHtml(rows)}
      ${btn(link("confirm"), "Approve", "#1F7A69", "#fff")}${btn(link("decline"), "Decline", "#fff;border:1px solid #D9D4CB", "#1D1B18")}${btn(REQUESTS_URL, "Open in Dayzift", "#F2C230", "#2A2305")}
      <p style="margin:14px 0 0;color:#6A655D;font-size:14px">${cust ? "Reply to this email to write to the customer directly." : "Call or text the customer at the contact above."}</p>`,
    "Dayzift booking alert");
  const text = `${lead}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n")
    + `\n\nApprove: ${link("confirm")}\nDecline: ${link("decline")}\nOpen in Dayzift: ${REQUESTS_URL}\n\nDayzift · A product of LIT America`;
  await transport().sendMail({ from: `"Dayzift for ${bizLabel(biz)}" <${SMTP_USER.value()}>`, to: to.join(", "), replyTo: cust || undefined, subject, html, text });
  return true;
}

// Pop-up alert on every phone signed in as an owner of this business, with the business's chosen sound.
async function pushOwners(biz, bizId, title, body) {
  const owners = new Set(biz.ownerUids || (biz.ownerUid ? [biz.ownerUid] : []));
  const snap = await admin.firestore().collection("devices").where("businessId", "==", bizId).get();
  const tokens = snap.docs.filter((d) => owners.has(d.get("uid"))).map((d) => d.id);
  if (!tokens.length) return;
  const snd = biz.alertSound || "chime";
  const res = await admin.messaging().sendEachForMulticast({
    tokens, notification: { title, body }, data: { kind: "booking" },
    android: { priority: "high", notification: { channelId: snd === "default" ? "bookings" : "bookings_" + snd, sound: snd === "default" ? "default" : snd } },
    apns: { payload: { aps: { sound: "default" } } },
  });
  await Promise.all(res.responses.map((r, i) => (!r.success && /registration-token-not-registered|invalid-argument/.test(r.error && r.error.code || ""))
    ? admin.firestore().doc("devices/" + tokens[i]).delete().catch(() => {}) : null));
}

async function emailCustomer(bk, biz, kind) {
  const to = await customerEmailFor(bk); if (!to) return false;
  const name = bizLabel(biz), day = reqDay(bk.requestedDate), svc = bk.service || "your service";
  const site = biz.website && /^https:\/\//i.test(biz.website) ? biz.website : "";
  const msgs = {
    received: [`We got your request: ${svc}${day ? " on " + day : ""}`,
      `Thanks for reaching out to ${name}! We received your request for ${svc}${day ? " on " + day : ""}. We'll check availability and email you as soon as it's confirmed.`],
    confirmed: [`Confirmed: ${svc}${day ? " on " + day : ""}`,
      `Good news! ${name} confirmed your ${svc}${day ? " for " + day : ""}. We'll see you then.`],
    declined: [`About your request for ${day || svc}`,
      `Thanks for thinking of ${name}. Unfortunately we can't take your ${svc} request${day ? " for " + day : ""}. Reply to this email or call us and we'll gladly find another day that works.`],
  }[kind];
  const contact = biz.phone ? ` or call ${biz.phone}` : "";
  const html = shell(name, `<p style="margin:0 0 14px">Hi ${esc(firstName(bk.name))},</p><p style="margin:0 0 16px">${esc(msgs[1])}</p>
      ${rowsHtml([["Service", bk.service], ["Date", day]].filter(([, v]) => v))}
      ${site ? btn(site, "Visit our website", "#F2C230", "#2A2305") : ""}
      <p style="margin:12px 0 0;color:#6A655D;font-size:14px">Questions? Reply to this email${esc(contact)}.</p>`, `Sent with Dayzift for ${esc(name)}`);
  const text = `Hi ${firstName(bk.name)},\n\n${msgs[1]}\n\nQuestions? Reply to this email${contact}.\n\n${name}\nSent with Dayzift · A product of LIT America`;
  const replyTo = okEmail(biz.email) ? biz.email : (await ownerEmailsFor(biz))[0];
  await transport().sendMail({ from: `"${name}" <${SMTP_USER.value()}>`, to, replyTo, subject: msgs[0], html, text });
  return true;
}

// 1 + 2) A new request came in.
exports.notifyNewBooking = onDocumentCreated({ document: "bookings/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const snap = event.data, bk = snap && snap.data();
  if (!bk || (bk.status || "pending") !== "pending" || !bk.businessId || bk.demo) return;
  const db = admin.firestore();
  const biz = (await db.doc("businesses/" + bk.businessId).get()).data();
  if (!bizOpen(biz)) return;
  // A secret for the Approve / Decline links, kept where customers can't read it.
  const key = crypto.randomBytes(18).toString("hex");
  await db.doc("bookingKeys/" + snap.id).set({ key, businessId: bk.businessId, createdAt: Date.now() });
  // Keep a lid on volume: a customer who sends lots of requests only gets the first few emails.
  let spam = false;
  if (bk.uid) {
    const mine = await db.collection("bookings").where("uid", "==", bk.uid).select("createdAt").get();
    spam = mine.docs.filter((d) => { const c = d.get("createdAt"); return c && (c.toMillis ? c.toMillis() : c) > Date.now() - 864e5; }).length > 5;
  }
  const day = reqDay(bk.requestedDate);
  const results = await Promise.allSettled([
    emailOwners(snap.id, bk, biz, key, 0),
    pushOwners(biz, bk.businessId, "New booking request", [bk.name, bk.service, day].filter(Boolean).join(" · ")),
    spam ? Promise.resolve(false) : emailCustomer(bk, biz, "received"),
  ]);
  results.forEach((r, i) => { if (r.status === "rejected") logger.error(["Owner email", "Owner push", "Customer email"][i] + " failed", r.reason); });
  const upd = { ownerNotifiedAt: Date.now() };
  if (results[2].status === "fulfilled" && results[2].value) upd.customerReceivedAt = Date.now();
  await snap.ref.update(upd).catch(() => {});
});

// 4) Approved or declined: tell the customer (once).
exports.notifyBookingAnswer = onDocumentUpdated({ document: "bookings/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const before = event.data.before.data() || {}, after = event.data.after.data() || {};
  const st = after.status;
  if (st === before.status || !["confirmed", "declined"].includes(st) || after.customerNotifiedAt || after.demo) return;
  const biz = (await admin.firestore().doc("businesses/" + after.businessId).get()).data();
  if (!bizOpen(biz)) return;
  try {
    if (await emailCustomer(after, biz, st)) await event.data.after.ref.update({ customerNotifiedAt: Date.now() });
  } catch (e) { logger.error("Customer answer email failed", e); }
  await admin.firestore().doc("bookingKeys/" + event.params.id).delete().catch(() => {});   // links stop working once answered
});

// 3) Every hour, 7 AM to 8 PM Central: remind owners about requests nobody has answered (every 2 hours, 3 times max).
exports.bookingReminders = onSchedule({ schedule: "0 7-20 * * *", timeZone: "America/Chicago", secrets: [SMTP_PASS] }, async () => {
  const db = admin.firestore(), now = Date.now(), today = todayCT();
  const snap = await db.collection("bookings").where("status", "==", "pending").get();
  let sent = 0;
  for (const d of snap.docs) {
    const bk = d.data();
    if (sent >= 100 || bk.demo) continue;
    const last = bk.lastReminderAt || bk.ownerNotifiedAt;
    if (!last || now - last < 2 * 36e5 - 6e5 || (bk.reminderCount || 0) >= 3) continue;
    if (bk.requestedDate && new Date(bk.requestedDate).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }) < today) continue;   // date already passed
    try {
      const biz = (await db.doc("businesses/" + bk.businessId).get()).data(); if (!bizOpen(biz)) continue;
      const k = (await db.doc("bookingKeys/" + d.id).get()).data(); if (!k) continue;
      const n = (bk.reminderCount || 0) + 1;
      await emailOwners(d.id, bk, biz, k.key, n);
      await pushOwners(biz, bk.businessId, "Still waiting: booking request", [bk.name, bk.service].filter(Boolean).join(" · ")).catch(() => {});
      await d.ref.update({ reminderCount: n, lastReminderAt: now });
      sent++;
    } catch (e) { logger.error("Booking reminder failed for " + d.id, e); }
  }
  logger.info("Booking reminders sent: " + sent);
});

// Approve / Decline from the owner's email. Opening the link only shows a page with a button,
// so email link-scanners can't approve anything by accident; the button press does it.
exports.bookingAction = onRequest({ invoker: "public", cors: false }, async (req, res) => {
  const page = (title, body, form) => res.status(200).set("Content-Type", "text/html; charset=utf-8").send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="font-family:Segoe UI,Arial,sans-serif;background:#F7F5F0;color:#1D1B18;margin:0;padding:40px 16px"><div style="max-width:480px;margin:auto;background:#fff;border:1px solid #E3E0D9;border-radius:14px;padding:26px">
<h1 style="font-size:22px;margin:0 0 10px">${esc(title)}</h1><p style="margin:0 0 18px;color:#4A463F">${body}</p>${form || ""}
<p style="margin:22px 0 0"><a href="${REQUESTS_URL}" style="color:#1F7A69;font-weight:700">Open Dayzift</a></p></div>
<p style="text-align:center;font-size:12px;color:#8A8278;margin-top:16px">Dayzift · A product of <a href="https://www.litamerica.net" style="color:#8A8278">LIT America</a></p></body></html>`);
  const src = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const id = String(src.id || "").slice(0, 128), k = String(src.k || "").slice(0, 80), a = src.a === "decline" ? "decline" : src.a === "confirm" ? "confirm" : "";
  if (!id || !k || !a || !/^[\w-]+$/.test(id)) return page("Link not valid", "This link is incomplete. Open Dayzift to answer the request.");
  const db = admin.firestore();
  const [keySnap, bkSnap] = await Promise.all([db.doc("bookingKeys/" + id).get(), db.doc("bookings/" + id).get()]);
  const bk = bkSnap.data(), stored = keySnap.exists && keySnap.get("key");
  const keyOk = stored && stored.length === k.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(k));
  if (!bk) return page("Request not found", "This booking request no longer exists.");
  if ((bk.status || "pending") !== "pending") return page("Already answered", `This request was already <b>${esc(bk.status)}</b>.`);
  if (!keyOk) return page("Link expired", "This link has expired. Open Dayzift to answer the request.");
  const what = `${esc(bk.service || "Request")} for ${esc(bk.name || "customer")}${bk.requestedDate ? " on " + esc(reqDay(bk.requestedDate)) : ""}`;
  if (req.method !== "POST") {
    return page(a === "confirm" ? "Approve this request?" : "Decline this request?", what + ".",
      `<form method="post"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="a" value="${a}">
       <button style="font:inherit;font-weight:800;border:0;border-radius:999px;padding:12px 22px;cursor:pointer;background:${a === "confirm" ? "#1F7A69;color:#fff" : "#B42318;color:#fff"}">${a === "confirm" ? "Yes, approve" : "Yes, decline"}</button></form>
       <p style="margin:14px 0 0;color:#6A655D;font-size:14px">The customer gets an email right away.</p>`);
  }
  await bkSnap.ref.update({ status: a === "confirm" ? "confirmed" : "declined", respondedVia: "email", respondedAt: admin.firestore.FieldValue.serverTimestamp() });
  return page(a === "confirm" ? "Approved ✓" : "Declined", what + (a === "confirm"
    ? ". The customer is being emailed now. Add the job to your board in Dayzift whenever you're ready."
    : ". The customer is being emailed now."));
});
