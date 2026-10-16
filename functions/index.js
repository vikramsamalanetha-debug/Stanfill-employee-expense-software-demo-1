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

// One email per person: if a single address is bad, the mail server refuses the whole message,
// so sending separately means everyone else still gets theirs. Bad addresses are logged by name.
async function sendEach(tr, msg, list, label) {
  const to = [...new Set(list.map((e) => String(e || "").trim().toLowerCase()).filter(Boolean))];
  let ok = 0;
  for (const addr of to) {
    try { await tr.sendMail({ ...msg, to: addr }); ok++; }
    catch (e) { logger.error(`${label} not delivered to ${addr}: ${(e && (e.response || e.message)) || e}`); }
  }
  if (to.length && !ok) throw new Error(`${label}: no address accepted (${to.join(", ")})`);
  return ok;
}

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
  await sendEach(transport, { from: `Dayzift <${SMTP_USER.value()}>`, subject, text, html }, adminList(), "Admin alert");
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
  const first = firstName(p.client && p.client.name);
  const ask = [b.phone ? "call " + nicePhone(b.phone) : "", okEmail(b.email) ? "email " + b.email : ""].filter(Boolean).join(" or ");
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
      ${ask ? `<p style="margin:18px 0 0;color:#6A655D;font-size:14px">Questions? Please ${esc(ask)}.</p>` : ""}
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#8A8278;text-align:center">Sent with Dayzift for ${esc(b.name)} · A product of <a href="https://www.litamerica.net" style="color:#8A8278">LIT America</a></p></div>`;
  const text = `Hi ${first},\n\n${intro}\n\nView invoice: ${url}\n` + (p.payLink ? `Pay online: ${p.payLink}\n` : "") + (p.payNote ? `How to pay: ${p.payNote}\n` : "")
    + (ask ? `\nQuestions? Please ${ask}.\n` : "") + `\n${b.name}\nSent with Dayzift · A product of LIT America`;
  return { subject, html, text };
}

async function mailInvoice(p, key, to, reminder) {
  const b = p.biz || {};
  const name = String(b.name || "Dayzift").replace(/["<>\r\n]/g, "").slice(0, 80);
  const msg = invoiceEmail(p, key, reminder);
  // No Reply-To: Yahoo refuses mail that asks for replies to go to another address. The business's contact is in the email instead.
  await transport().sendMail({ from: `"${name} via Dayzift" <${SMTP_USER.value()}>`, to, ...msg });
}

// Same rule as the app: only businesses waiting for approval or suspended are blocked.
// Businesses created before approvals existed have no status, and they are active.
const bizOpen = (b) => !!b && b.status !== "pending" && b.status !== "suspended" && b.status !== "archived";

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
// Time of day the customer asked for (website booking form).
const WIN = { morning: "Morning (8 AM–12 PM)", afternoon: "Afternoon (12–5 PM)", any: "Any time" };
const winShort = (w) => (w === "morning" ? "morning" : w === "afternoon" ? "afternoon" : "");
// "Tue, Oct 20, 2026, morning" — the date plus the time of day when there is one.
const dayWin = (iso, w) => { const d = reqDay(iso); return d && winShort(w) ? d + ", " + winShort(w) : d; };
// "Hi Jane" — but never greet someone by an email address or a number.
const firstName = (n) => { const f = String(n || "").trim().split(/\s+/)[0]; return f && !/[@\d]/.test(f) ? f : "there"; };
// 7316022456 → 731-602-2456 (anything that isn't a 10-digit US number is left as typed)
const nicePhone = (p) => { const d = String(p || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : String(p || ""); };

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
  return [["Service", bk.service], ["Date wanted", reqDay(bk.requestedDate)], ["Time", WIN[bk.timeWindow] || ""], ["Size", bk.size], ["Name", bk.name], ["Contact", /@/.test(bk.phone || "") ? bk.phone : nicePhone(bk.phone)],
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
  const day = dayWin(bk.requestedDate, bk.timeWindow);
  const subject = (reminderNo ? `Reminder: ` : `New booking request: `) + `${bk.service || "Service"}${day ? ", " + day : ""} (${bk.name || "customer"})`;
  const lead = reminderNo
    ? `This request is still waiting for an answer (reminder ${reminderNo} of 3).`
    : `You have a new booking request from your website.`;
  // "Account email" is who actually sent the request (their sign-in); the rest is what they typed.
  const rows = bookingRows(bk, biz).concat(cust && cust !== bk.phone ? [["Account email", cust]] : []);
  const html = shell(bizLabel(biz), `<p style="margin:0 0 16px">${esc(lead)}</p>${rowsHtml(rows)}
      ${btn(link("confirm"), "Approve", "#1F7A69", "#fff")}${btn(link("decline"), "Decline", "#fff;border:1px solid #D9D4CB", "#1D1B18")}${btn(REQUESTS_URL, "Open in Dayzift", "#F2C230", "#2A2305")}
      <p style="margin:14px 0 0;color:#6A655D;font-size:14px">${cust ? "Customer email: " + esc(cust) + ". " : ""}Call, text or email the customer at the contact above.</p>`,
    "Dayzift booking alert");
  const text = `${lead}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n")
    + `\n\nApprove: ${link("confirm")}\nDecline: ${link("decline")}\nOpen in Dayzift: ${REQUESTS_URL}\n\nDayzift · A product of LIT America`;
  await sendEach(transport(), { from: `"Dayzift for ${bizLabel(biz)}" <${SMTP_USER.value()}>`, subject, html, text }, to, "Owner email");
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
  const ch = bk.change || {};
  const name = bizLabel(biz), day = dayWin(bk.requestedDate, bk.timeWindow), svc = bk.service || "your service";
  const fromW = dayWin(ch.from, ch.fromWindow != null ? ch.fromWindow : bk.timeWindow), toW = dayWin(ch.to, ch.window != null ? ch.window : bk.timeWindow);
  const site = biz.website && /^https:\/\//i.test(biz.website) ? biz.website : "";
  const msgs = {
    received: [`We got your request: ${svc}${day ? " on " + day : ""}`,
      `Thanks for reaching out to ${name}! We received your request for ${svc}${day ? " on " + day : ""}. We'll check availability and email you as soon as it's confirmed.`],
    confirmed: [`Confirmed: ${svc}${day ? " on " + day : ""}`,
      `Good news! ${name} confirmed your ${svc}${day ? " for " + day : ""}. We'll see you then.`],
    declined: [`About your request for ${day || svc}`,
      `Thanks for thinking of ${name}. Unfortunately we can't take your ${svc} request${day ? " for " + day : ""}. Get in touch and we'll gladly find another day that works.`],
    change_received: [`We got your date change: ${svc}`,
      `We received your request to move your ${svc} from ${fromW} to ${toW}. Your original date stays booked until we confirm the new one by email.`],
    change_ok: [`Confirmed: your new date is ${toW}`,
      `You're all set! ${name} moved your ${svc} from ${fromW} to ${toW}. We'll see you then.`],
    change_no: [`About your date change for ${svc}`,
      `Sorry, we can't move your ${svc} to ${toW}. Your original date, ${fromW}, is still booked. Get in touch and we'll find another day that works.`],
    change_late: [`About your date change for ${svc}`,
      `Your ${svc} on ${fromW} is less than 24 hours away, so it can't be changed online anymore. Please get in touch with us directly and we'll do our best to help.`],
    cancelled: [`Cancelled: ${svc}${day ? " on " + day : ""}`,
      `Your ${svc}${day ? " on " + day : ""} with ${name} is cancelled. We hope to see you again soon. You can book another day on our website any time.`],
  }[kind];
  const bizMail = okEmail(biz.email) ? biz.email : "";
  const contact = [biz.phone ? "call " + nicePhone(biz.phone) : "", bizMail ? "email " + bizMail : ""].filter(Boolean).join(" or ");
  const html = shell(name, `<p style="margin:0 0 14px">Hi ${esc(firstName(bk.name))},</p><p style="margin:0 0 16px">${esc(msgs[1])}</p>
      ${rowsHtml((/^change_/.test(kind) ? [["Service", bk.service], ["Booked date", fromW], ["New date", toW]] : [["Service", bk.service], ["Date", reqDay(bk.requestedDate)], ["Time", WIN[bk.timeWindow] || ""]]).filter(([, v]) => v))}
      ${site ? btn(site, "Visit our website", "#F2C230", "#2A2305") : ""}
      ${contact ? `<p style="margin:12px 0 0;color:#6A655D;font-size:14px">Questions? Please ${esc(contact)}.</p>` : ""}`, `Sent with Dayzift for ${esc(name)}`);
  const text = `Hi ${firstName(bk.name)},\n\n${msgs[1]}\n\n` + (contact ? `Questions? Please ${contact}.\n\n` : "") + `${name}\nSent with Dayzift · A product of LIT America`;
  await transport().sendMail({ from: `"${name}" <${SMTP_USER.value()}>`, to, subject: msgs[0], html, text });
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
  const day = dayWin(bk.requestedDate, bk.timeWindow);
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
// Customers can change the date or cancel up to 24 hours before (counted from 8 AM on the booked day).
const changeCutoff = (iso) => { const t = Date.parse(iso || ""); return isNaN(t) ? 0 : t + 8 * 36e5 - 24 * 36e5; };

// Owners: a customer wants a different date (Approve / Decline), or cancelled.
async function emailOwnersAbout(id, bk, biz, kind, key) {
  const to = await ownerEmailsFor(biz); if (!to.length) return false;
  const cust = await customerEmailFor(bk), ch = bk.change || {};
  const fromW = dayWin(ch.from, ch.fromWindow != null ? ch.fromWindow : bk.timeWindow), toW = dayWin(ch.to, ch.window != null ? ch.window : bk.timeWindow);
  const link = (a) => `${ACTION_URL}?id=${encodeURIComponent(id)}&k=${key}&a=${a}`;
  const late = kind === "cancel" && Date.now() > changeCutoff(ch.from || bk.requestedDate);
  const subject = kind === "change"
    ? `Date change request: ${bk.name || "customer"} wants ${toW} instead of ${fromW}`
    : `Cancelled: ${bk.service || "booking"}, ${dayWin(ch.from || bk.requestedDate, bk.timeWindow)} (${bk.name || "customer"})`;
  const lead = kind === "change"
    ? `${bk.name || "A customer"} wants to move their ${bk.service || "booking"}. The original date stays booked until you approve.`
    : `${bk.name || "A customer"} cancelled their ${bk.service || "booking"}${late ? " with less than 24 hours' notice" : ""}. If it's on your job board, remove or reschedule it there.`;
  const rows = (kind === "change"
    ? [["Service", bk.service], ["Booked date", fromW], ["Wants instead", toW]]
    : [["Service", bk.service], ["Date", dayWin(ch.from || bk.requestedDate, bk.timeWindow)]])
    .concat([["Name", bk.name], ["Contact", /@/.test(bk.phone || "") ? bk.phone : nicePhone(bk.phone)], ["Account email", cust]]).filter(([, v]) => v);
  const buttons = kind === "change"
    ? btn(link("moveok"), "Approve new date", "#1F7A69", "#fff") + btn(link("moveno"), "Keep original date", "#fff;border:1px solid #D9D4CB", "#1D1B18") : "";
  const html = shell(bizLabel(biz), `<p style="margin:0 0 16px">${esc(lead)}</p>${rowsHtml(rows)}${buttons}${btn(REQUESTS_URL, "Open in Dayzift", "#F2C230", "#2A2305")}`, "Dayzift booking alert");
  const text = `${lead}\n\n` + rows.map(([k, v]) => `${k}: ${v}`).join("\n")
    + (kind === "change" ? `\n\nApprove new date: ${link("moveok")}\nKeep original date: ${link("moveno")}` : "") + `\nOpen in Dayzift: ${REQUESTS_URL}\n\nDayzift · A product of LIT America`;
  await sendEach(transport(), { from: `"Dayzift for ${bizLabel(biz)}" <${SMTP_USER.value()}>`, subject, html, text }, to, "Owner email");
  return true;
}

exports.notifyBookingAnswer = onDocumentUpdated({ document: "bookings/{id}", secrets: [SMTP_PASS] }, async (event) => {
  const before = event.data.before.data() || {}, after = event.data.after.data() || {};
  if (after.demo || !after.businessId) return;
  const id = event.params.id, ref = event.data.after.ref, db = admin.firestore();
  const bc = before.change || {}, ac = after.change || {};
  let biz = null;
  const loadBiz = async () => biz || (biz = (await db.doc("businesses/" + after.businessId).get()).data());
  const safe = async (label, fn) => { try { await fn(); } catch (e) { logger.error(label + " failed", e); } };

  // A) The customer asked for a different date.
  if (ac.type === "reschedule" && ac.status === "pending" && ac.at !== bc.at) {
    if (!bizOpen(await loadBiz())) return;
    if (Date.now() > changeCutoff(ac.from)) {      // too close to the appointment: they need to call
      await ref.update({ "change.status": "too_late" });
      return safe("Late change email", () => emailCustomer(after, biz, "change_late"));
    }
    const key = crypto.randomBytes(18).toString("hex");
    await db.doc("bookingKeys/" + id).set({ key, businessId: after.businessId, createdAt: Date.now(), kind: "change" });
    await Promise.all([
      safe("Owner change email", () => emailOwnersAbout(id, after, biz, "change", key)),
      safe("Owner change push", () => pushOwners(biz, after.businessId, "Date change request", [after.name, dayWin(ac.to, ac.window)].filter(Boolean).join(" \u00b7 "))),
      safe("Customer change email", () => emailCustomer(after, biz, "change_received")),
    ]);
    return;
  }

  // B) The owner answered a date change (in the app or from the email).
  if (ac.type === "reschedule" && bc.status === "pending" && (ac.status === "approved" || ac.status === "declined")) {
    if (!bizOpen(await loadBiz())) return;
    if (ac.status === "approved") {
      const newWin = ac.window != null ? ac.window : (after.timeWindow || "");
      await ref.update({ requestedDate: ac.to, timeWindow: newWin, status: "confirmed", customerNotifiedAt: after.customerNotifiedAt || Date.now() });
      // move the job made from this booking to the new day (and time of day)
      const newDay = new Date(ac.to).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
      const jobs = await db.collection("jobs").where("fromBookingId", "==", id).get();
      await Promise.all(jobs.docs.filter((d) => d.get("businessId") === after.businessId && d.get("status") !== "done").map((d) => d.ref.update({ date: newDay, window: newWin })));
    }
    await safe("Customer change answer email", () => emailCustomer(after, biz, ac.status === "approved" ? "change_ok" : "change_no"));
    await db.doc("bookingKeys/" + id).delete().catch(() => {});
    return;
  }

  // C) The customer cancelled.
  if (after.status === "cancelled" && before.status !== "cancelled") {
    if (!bizOpen(await loadBiz())) return;
    await Promise.all([
      safe("Owner cancel email", () => emailOwnersAbout(id, after, biz, "cancel", "")),
      safe("Owner cancel push", () => pushOwners(biz, after.businessId, "Booking cancelled", [after.name, reqDay((ac.from) || after.requestedDate)].filter(Boolean).join(" \u00b7 "))),
      safe("Customer cancel email", () => emailCustomer(after, biz, "cancelled")),
    ]);
    await db.doc("bookingKeys/" + id).delete().catch(() => {});
    return;
  }

  // D) The owner answered the original request.
  const st = after.status;
  if (st === before.status || !["confirmed", "declined"].includes(st) || after.customerNotifiedAt) return;
  if (!bizOpen(await loadBiz())) return;
  try {
    if (await emailCustomer(after, biz, st)) await ref.update({ customerNotifiedAt: Date.now() });
  } catch (e) { logger.error("Customer answer email failed", e); }
  await db.doc("bookingKeys/" + id).delete().catch(() => {});   // links stop working once answered
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
  const id = String(src.id || "").slice(0, 128), k = String(src.k || "").slice(0, 80), a = ["confirm", "decline", "moveok", "moveno"].includes(src.a) ? src.a : "";
  if (!id || !k || !a || !/^[\w-]+$/.test(id)) return page("Link not valid", "This link is incomplete. Open Dayzift to answer the request.");
  const db = admin.firestore();
  const [keySnap, bkSnap] = await Promise.all([db.doc("bookingKeys/" + id).get(), db.doc("bookings/" + id).get()]);
  const bk = bkSnap.data(), stored = keySnap.exists && keySnap.get("key");
  const keyOk = stored && stored.length === k.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(k));
  if (!bk) return page("Request not found", "This booking request no longer exists.");
  if (a === "moveok" || a === "moveno") {     // answering a date change
    const ch = bk.change || {};
    if (bk.status === "cancelled") return page("Booking cancelled", "The customer has cancelled this booking.");
    if (ch.type !== "reschedule" || ch.status !== "pending") return page("Already answered", "This date change was already answered.");
    if (!keyOk) return page("Link expired", "This link has expired. Open Dayzift to answer the request.");
    const what2 = `${esc(bk.service || "Booking")} for ${esc(bk.name || "customer")}: ${esc(reqDay(ch.from))} \u2192 <b>${esc(reqDay(ch.to))}</b>`;
    if (req.method !== "POST") {
      return page(a === "moveok" ? "Approve the new date?" : "Keep the original date?", what2 + ".",
        `<form method="post"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="k" value="${esc(k)}"><input type="hidden" name="a" value="${a}">
         <button style="font:inherit;font-weight:800;border:0;border-radius:999px;padding:12px 22px;cursor:pointer;background:${a === "moveok" ? "#1F7A69" : "#1D1B18"};color:#fff">${a === "moveok" ? "Yes, move it" : "Yes, keep the original"}</button></form>
         <p style="margin:14px 0 0;color:#6A655D;font-size:14px">The customer gets an email right away.</p>`);
    }
    await bkSnap.ref.update({ "change.status": a === "moveok" ? "approved" : "declined", "change.answeredVia": "email", "change.answeredAt": Date.now() });
    return page(a === "moveok" ? "Moved \u2713" : "Original date kept", what2 + (a === "moveok"
      ? ". The customer is being emailed, and the job on your board moves to the new day."
      : ". The customer is being emailed that the original date stands."));
  }
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

// ---------- Booking calendar (public copy for the business's website) ----------
// The owner sets the calendar in Dayzift (Settings → Booking calendar). These keep publicCalendars/{bizId}
// in step with it, and add "fullDates": days that already have as many jobs as the owner's daily limit.
// Only these functions write publicCalendars; the website only reads it.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const CAL_KEYS = ["closedWeekdays", "holidays", "closedDates", "closedRanges", "maxPerDay", "minNoticeDays", "maxWeeksAhead", "windows", "maxMorning", "maxAfternoon"];
const ctDay = (v) => { const t = typeof v === "number" ? v : Date.parse(v || ""); return isNaN(t) ? "" : new Date(t).toLocaleDateString("en-CA", { timeZone: "America/Chicago" }); };
const bookingDay = (iso) => ctDay(iso);
// Which half of the day a job is in: its start time if the owner set one, else what the customer asked for. "" = no set time.
const jobWin = (j) => j.time ? (j.time < "12:00" ? "morning" : "afternoon") : (j.window === "morning" || j.window === "afternoon") ? j.window : "";

// Re-check which days and half-days are full (today through the booking horizon) and publish them.
// Counts jobs on the board plus confirmed bookings not turned into a job yet.
async function recomputeFull(db, bizId, biz) {
  const c = (biz && biz.calendar) || {}, max = Number(c.maxPerDay) || 0;
  const wins = c.windows !== false, maxM = wins ? Number(c.maxMorning) || 0 : 0, maxA = wins ? Number(c.maxAfternoon) || 0 : 0;
  const pub = { updatedAt: Date.now(), fullDates: [], fullSlots: [] };
  CAL_KEYS.forEach((k) => { if (c[k] !== undefined) pub[k] = c[k]; });
  if (max || maxM || maxA) {
    const today = ctDay(Date.now());
    const horizon = ctDay(Date.now() + (Number(c.maxWeeksAhead) || 26) * 7 * 864e5);
    const [jobs, bks] = await Promise.all([
      db.collection("jobs").where("businessId", "==", bizId).get(),   // one filter only: no extra database index needed
      db.collection("bookings").where("businessId", "==", bizId).where("status", "==", "confirmed").get(),
    ]);
    const count = {}, fromBooking = new Set();
    const add = (day, w) => { if (!day || day < today || day > horizon) return; const k = count[day] || (count[day] = { n: 0, morning: 0, afternoon: 0 }); k.n++; if (w) k[w]++; };
    jobs.docs.forEach((d) => { if (d.get("fromBookingId")) fromBooking.add(d.get("fromBookingId")); add(d.get("date"), jobWin(d.data())); });
    bks.docs.forEach((d) => { if (!fromBooking.has(d.id)) add(bookingDay(d.get("requestedDate")), winShort(d.get("timeWindow"))); });
    Object.keys(count).sort().forEach((day) => {
      const k = count[day];
      const mFull = maxM && k.morning >= maxM, aFull = maxA && k.afternoon >= maxA;
      if (mFull) pub.fullSlots.push(day + "|morning");
      if (aFull) pub.fullSlots.push(day + "|afternoon");
      if ((max && k.n >= max) || (mFull && aFull)) pub.fullDates.push(day);
    });
  }
  await db.doc("publicCalendars/" + bizId).set(pub);
}
async function recheckBiz(bizId) {
  if (!bizId) return;
  const db = admin.firestore();
  const biz = (await db.doc("businesses/" + bizId).get()).data(); if (!biz) return;
  await recomputeFull(db, bizId, biz);
}

// Owner changed the calendar (or the business was created): publish it and recount full days.
exports.syncCalendar = onDocumentWritten({ document: "businesses/{id}" }, async (event) => {
  const before = (event.data.before && event.data.before.data()) || {}, after = (event.data.after && event.data.after.data()) || null;
  if (!after) return;
  if (JSON.stringify(before.calendar || null) === JSON.stringify(after.calendar || null) && event.data.before && event.data.before.exists) return;
  try { await recomputeFull(admin.firestore(), event.params.id, after); } catch (e) { logger.error("Calendar sync failed", e); }
});
// A job was added, moved or removed: its old and new day may have filled up or opened again.
exports.calendarJobs = onDocumentWritten({ document: "jobs/{id}" }, async (event) => {
  const b = (event.data.before && event.data.before.data()) || {}, a = (event.data.after && event.data.after.data()) || {};
  if (b.date === a.date && b.businessId === a.businessId && jobWin(b) === jobWin(a)) return;
  try { await recheckBiz(a.businessId || b.businessId); } catch (e) { logger.error("Calendar job recheck failed", e); }
});
// A booking was confirmed, moved or cancelled.
exports.calendarBookings = onDocumentWritten({ document: "bookings/{id}" }, async (event) => {
  const b = (event.data.before && event.data.before.data()) || {}, a = (event.data.after && event.data.after.data()) || {};
  const was = b.status === "confirmed" ? bookingDay(b.requestedDate) + winShort(b.timeWindow) : "", now = a.status === "confirmed" ? bookingDay(a.requestedDate) + winShort(a.timeWindow) : "";
  if (was === now) return;
  try { await recheckBiz(a.businessId || b.businessId); } catch (e) { logger.error("Calendar booking recheck failed", e); }
});
