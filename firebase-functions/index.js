"use strict";

const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");

admin.initializeApp();

const resendApiKey = defineSecret("RESEND_API_KEY");
const db = admin.firestore();
const bucket = admin.storage().bucket();

const CONFIG = {
  companyId: process.env.COMPANY_ID || "han-dienstleister",
  companyName: "HAN Dienstleister GmbH",
  domain: process.env.PUBLIC_DOMAIN || "https://han-dienstleister.de",
  mailFrom: process.env.MAIL_FROM || "HAN Dienstleister <no-reply@han-dienstleister.de>",
  adminEmail: process.env.ADMIN_EMAIL || "info@han-dienstleister.de",
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL || "admin@han-dienstleister.de"
};

const CONTACT_STATUSES = new Set(["new", "open", "in_progress", "waiting_customer", "accepted", "rejected", "done", "archived"]);
const REVIEW_STATUSES = new Set(["pending", "approved", "rejected"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

exports.submitContactRequest = onCall({ region: "europe-west3", cors: true, secrets: [resendApiKey] }, async (request) => {
  const data = request.data || {};
  const ipHash = hashIp(request.rawRequest.ip || request.rawRequest.headers["x-forwarded-for"] || "unknown");
  await enforceServerRateLimit(`contact_${ipHash}`, 3, 60 * 60 * 1000);

  if (sanitize(data.website, 120)) {
    return { ok: true };
  }

  const payload = {
    companyId: CONFIG.companyId,
    name: sanitize(data.name, 120),
    company: sanitize(data.company, 120),
    phone: sanitize(data.phone, 40),
    email: sanitize(data.email, 160).toLowerCase(),
    service: sanitize(data.service, 120),
    message: sanitizeMultiline(data.message, 1500),
    sourcePath: sanitize(data.sourcePath, 180),
    status: "new",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ipHash
  };

  validateContact(payload, data.consent);

  const doc = await db.collection("contactRequests").add(payload);
  await sendContactEmails(doc.id, payload);
  return { ok: true, id: doc.id };
});

exports.submitReview = onCall({ region: "europe-west3", cors: true }, async (request) => {
  const data = request.data || {};
  const ipHash = hashIp(request.rawRequest.ip || request.rawRequest.headers["x-forwarded-for"] || "unknown");
  await enforceServerRateLimit(`review_${ipHash}`, 2, 24 * 60 * 60 * 1000);

  const rating = Number(data.rating);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5 || rating * 2 !== Math.round(rating * 2)) {
    throw new HttpsError("invalid-argument", "Ungueltige Bewertung.");
  }

  const reviewRef = db.collection("reviews").doc();
  const uploads = await uploadReviewImages(reviewRef.id, data);
  const payload = {
    companyId: CONFIG.companyId,
    name: sanitize(data.name, 120),
    rating,
    text: sanitizeMultiline(data.text, 1000),
    status: "pending",
    profileImageUrl: uploads.profileImageUrl || null,
    imageUrl: uploads.imageUrl || null,
    sourcePath: sanitize(data.sourcePath, 180),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ipHash
  };

  if (payload.name.length < 2) {
    throw new HttpsError("invalid-argument", "Name fehlt.");
  }

  await reviewRef.set(payload);
  await sendAdminMail("Neue Bewertung wartet auf Freigabe", adminReviewHtml(payload));
  return { ok: true, id: reviewRef.id };
});

exports.listApprovedReviews = onCall({ region: "europe-west3", cors: true }, async (request) => {
  const data = request.data || {};
  const pageSize = Math.min(Math.max(Number(data.pageSize) || 6, 1), 12);
  const order = ["highest", "lowest", "newest"].includes(data.order) ? data.order : "newest";
  const orderField = order === "newest" ? "publishedAt" : "rating";
  const direction = order === "lowest" ? "asc" : "desc";

  let query = db.collection("reviews")
    .where("companyId", "==", CONFIG.companyId)
    .where("status", "==", "approved")
    .orderBy(orderField, direction)
    .limit(pageSize);

  if (data.cursor) {
    const cursorDoc = await db.collection("reviews").doc(String(data.cursor)).get();
    if (cursorDoc.exists) query = query.startAfter(cursorDoc);
  }

  const snapshot = await query.get();
  const reviews = snapshot.docs.map((doc) => publicReview(doc));
  const summary = await calculateReviewSummary();
  return {
    reviews,
    summary,
    nextCursor: snapshot.size === pageSize ? snapshot.docs[snapshot.docs.length - 1].id : null
  };
});

exports.updateRequestStatus = onCall({ region: "europe-west3" }, async (request) => {
  assertAdmin(request);
  const id = sanitize(request.data.id, 120);
  const status = sanitize(request.data.status, 40);
  if (!CONTACT_STATUSES.has(status)) throw new HttpsError("invalid-argument", "Ungueltiger Status.");

  await db.collection("contactRequests").doc(id).update({
    status,
    internalNotes: sanitizeMultiline(request.data.internalNotes, 2000),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return { ok: true };
});

exports.moderateReview = onCall({ region: "europe-west3" }, async (request) => {
  assertAdmin(request);
  const id = sanitize(request.data.id, 120);
  const status = sanitize(request.data.status, 40);
  if (!REVIEW_STATUSES.has(status)) throw new HttpsError("invalid-argument", "Ungueltiger Status.");

  const update = {
    status,
    rating: Number(request.data.rating) || undefined,
    text: sanitizeMultiline(request.data.text, 1000),
    companyReply: sanitizeMultiline(request.data.companyReply, 1000),
    moderatedAt: admin.firestore.FieldValue.serverTimestamp(),
    moderatedBy: request.auth.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  if (status === "approved") {
    update.publishedAt = admin.firestore.FieldValue.serverTimestamp();
  }

  await db.collection("reviews").doc(id).update(removeUndefined(update));
  return { ok: true };
});

exports.confirmAppointment = onCall({ region: "europe-west3", secrets: [resendApiKey] }, async (request) => {
  assertAdmin(request);
  const data = request.data || {};
  const requestRef = db.collection("contactRequests").doc(sanitize(data.requestId, 120));
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) throw new HttpsError("not-found", "Anfrage nicht gefunden.");
  const contact = requestSnap.data();

  const appointment = {
    date: sanitize(data.date, 20),
    time: sanitize(data.time, 20),
    durationMinutes: Math.min(Math.max(Number(data.durationMinutes) || 60, 15), 480),
    location: sanitize(data.location, 200),
    meetingUrl: sanitize(data.meetingUrl, 300),
    description: sanitizeMultiline(data.description, 1000),
    contactPerson: sanitize(data.contactPerson, 120) || CONFIG.companyName
  };
  validateAppointment(appointment);

  const ics = buildIcs(contact, appointment);
  await requestRef.update({
    status: "accepted",
    appointment,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await sendMail({
    to: contact.email,
    subject: "Ihr Termin mit HAN Dienstleister GmbH",
    html: appointmentCustomerHtml(contact, appointment),
    attachments: [{ filename: "termin-han-dienstleister.ics", content: Buffer.from(ics).toString("base64") }]
  });

  return {
    ok: true,
    calendar: {
      googleUrl: buildGoogleCalendarUrl(contact, appointment),
      ics
    }
  };
});

exports.setUserRole = onCall({ region: "europe-west3" }, async (request) => {
  assertSuperAdmin(request);
  const { uid, role, companyId } = request.data || {};
  if (!uid || !["superAdmin", "companyAdmin"].includes(role)) {
    throw new HttpsError("invalid-argument", "Ungueltige Rolle.");
  }
  await admin.auth().setCustomUserClaims(uid, { role, companyId: companyId || CONFIG.companyId });
  await db.collection("users").doc(uid).set({
    role,
    companyId: companyId || CONFIG.companyId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { ok: true };
});

function assertAdmin(request) {
  if (!request.auth || !["superAdmin", "companyAdmin"].includes(request.auth.token.role)) {
    throw new HttpsError("permission-denied", "Nicht autorisiert.");
  }
}

function assertSuperAdmin(request) {
  if (!request.auth || request.auth.token.role !== "superAdmin") {
    throw new HttpsError("permission-denied", "Nur Super Admins duerfen diese Aktion ausfuehren.");
  }
}

function validateContact(payload, consent) {
  if (!consent) throw new HttpsError("failed-precondition", "Datenschutz-Zustimmung fehlt.");
  if (payload.name.length < 2) throw new HttpsError("invalid-argument", "Name fehlt.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(payload.email)) throw new HttpsError("invalid-argument", "E-Mail ungueltig.");
  if (!/^\+?[0-9\s()/.-]{6,24}$/.test(payload.phone)) throw new HttpsError("invalid-argument", "Telefonnummer ungueltig.");
  if (!payload.service) throw new HttpsError("invalid-argument", "Service fehlt.");
  if (payload.message.length < 20) throw new HttpsError("invalid-argument", "Nachricht zu kurz.");
}

function validateAppointment(appointment) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || !/^\d{2}:\d{2}$/.test(appointment.time)) {
    throw new HttpsError("invalid-argument", "Datum oder Uhrzeit ungueltig.");
  }
}

async function enforceServerRateLimit(key, maxAttempts, windowMs) {
  const ref = db.collection("rateLimits").doc(key);
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    const now = Date.now();
    const attempts = snap.exists ? (snap.data().attempts || []).filter((time) => now - time < windowMs) : [];
    if (attempts.length >= maxAttempts) {
      throw new HttpsError("resource-exhausted", "Zu viele Versuche. Bitte spaeter erneut versuchen.");
    }
    attempts.push(now);
    transaction.set(ref, { attempts, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  });
}

async function uploadReviewImages(reviewId, data) {
  const result = {};
  if (data.profileImage) result.profileImageUrl = await uploadPublicImage(`reviews/${CONFIG.companyId}/${reviewId}/profile`, data.profileImage);
  if (data.reviewImage) result.imageUrl = await uploadPublicImage(`reviews/${CONFIG.companyId}/${reviewId}/image`, data.reviewImage);
  return result;
}

async function uploadPublicImage(path, file) {
  if (!file || !IMAGE_TYPES.has(file.type) || Number(file.size) > 2 * 1024 * 1024) {
    throw new HttpsError("invalid-argument", "Bilddatei ungueltig.");
  }
  const match = String(file.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match || match[1] !== file.type) throw new HttpsError("invalid-argument", "Bilddaten ungueltig.");
  const extension = file.type.split("/")[1].replace("jpeg", "jpg");
  const destination = `${path}.${extension}`;
  const storageFile = bucket.file(destination);
  await storageFile.save(Buffer.from(match[2], "base64"), {
    metadata: { contentType: file.type, cacheControl: "public,max-age=31536000,immutable" },
    resumable: false
  });
  await storageFile.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${destination}`;
}

async function sendContactEmails(id, payload) {
  await sendMail({
    to: payload.email,
    subject: "Ihre Anfrage bei HAN Dienstleister GmbH",
    html: customerConfirmationHtml(payload)
  });
  await sendAdminMail(`Neue Anfrage: ${payload.service}`, adminContactHtml(id, payload));
}

async function sendAdminMail(subject, html) {
  await Promise.all([
    sendMail({ to: CONFIG.adminEmail, subject, html }),
    CONFIG.superAdminEmail !== CONFIG.adminEmail ? sendMail({ to: CONFIG.superAdminEmail, subject, html }) : Promise.resolve()
  ]);
}

async function sendMail({ to, subject, html, attachments }) {
  const apiKey = resendApiKey.value();
  if (!apiKey) {
    logger.warn("RESEND_API_KEY fehlt. E-Mail wurde nicht versendet.", { to, subject });
    return;
  }
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: CONFIG.mailFrom,
    to,
    subject,
    html,
    attachments
  });
}

function customerConfirmationHtml(payload) {
  return emailShell("Vielen Dank für Ihre Anfrage", `
    <p>Hallo ${escapeHtml(payload.name)},</p>
    <p>wir haben Ihre Anfrage zum Bereich <strong>${escapeHtml(payload.service)}</strong> erhalten und melden uns schnellstmöglich persönlich bei Ihnen.</p>
    <p><strong>Ihre Nachricht:</strong><br>${escapeHtml(payload.message).replace(/\n/g, "<br>")}</p>
  `);
}

function adminContactHtml(id, payload) {
  return emailShell("Neue Anfrage", `
    <p><strong>ID:</strong> ${escapeHtml(id)}</p>
    <p><strong>Name:</strong> ${escapeHtml(payload.name)}<br>
    <strong>Firma:</strong> ${escapeHtml(payload.company || "-")}<br>
    <strong>Telefon:</strong> ${escapeHtml(payload.phone)}<br>
    <strong>E-Mail:</strong> ${escapeHtml(payload.email)}<br>
    <strong>Service:</strong> ${escapeHtml(payload.service)}</p>
    <p>${escapeHtml(payload.message).replace(/\n/g, "<br>")}</p>
  `);
}

function adminReviewHtml(payload) {
  return emailShell("Neue Bewertung", `
    <p><strong>Name:</strong> ${escapeHtml(payload.name)}<br>
    <strong>Bewertung:</strong> ${payload.rating} / 5</p>
    <p>${escapeHtml(payload.text || "-").replace(/\n/g, "<br>")}</p>
  `);
}

function appointmentCustomerHtml(contact, appointment) {
  const start = `${appointment.date} ${appointment.time}`;
  return emailShell("Ihr Termin wurde bestätigt", `
    <p>Hallo ${escapeHtml(contact.name)},</p>
    <p>Ihr Termin mit der HAN Dienstleister GmbH wurde bestätigt.</p>
    <table role="presentation" style="width:100%;border-collapse:collapse;margin:20px 0">
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>Datum und Uhrzeit</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(start)}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>Dauer</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${appointment.durationMinutes} Minuten</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>Ort</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(appointment.location || "Nach Vereinbarung")}</td></tr>
      <tr><td style="padding:8px;border-bottom:1px solid #e5e7eb"><strong>Ansprechpartner</strong></td><td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(appointment.contactPerson)}</td></tr>
    </table>
    ${appointment.meetingUrl ? `<p><a href="${escapeHtml(appointment.meetingUrl)}" style="display:inline-block;background:#E8740C;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Meeting öffnen</a></p>` : ""}
    <p>Die Kalenderdatei finden Sie im Anhang.</p>
  `);
}

function emailShell(title, body) {
  return `
    <div style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#2C3E50">
      <div style="max-width:640px;margin:0 auto;padding:28px">
        <div style="background:#0F2B46;color:#fff;padding:22px 26px;border-radius:10px 10px 0 0">
          <strong style="font-size:18px">HAN Dienstleister GmbH</strong>
        </div>
        <div style="background:#fff;padding:28px;border:1px solid #DFE4EA;border-top:0;border-radius:0 0 10px 10px">
          <h1 style="margin:0 0 18px;color:#0F2B46;font-size:24px">${escapeHtml(title)}</h1>
          ${body}
          <p style="margin-top:26px;color:#5A6B7D;font-size:14px">HAN Dienstleister GmbH<br>Am Dreschplatz 8, 67136 Fußgönnheim<br><a href="mailto:info@han-dienstleister.de">info@han-dienstleister.de</a></p>
        </div>
      </div>
    </div>`;
}

function buildIcs(contact, appointment) {
  const start = new Date(`${appointment.date}T${appointment.time}:00`);
  const end = new Date(start.getTime() + appointment.durationMinutes * 60000);
  const uid = `${crypto.randomUUID()}@han-dienstleister.de`;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HAN Dienstleister GmbH//Appointment//DE",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatIcsDate(new Date())}`,
    `DTSTART:${formatIcsDate(start)}`,
    `DTEND:${formatIcsDate(end)}`,
    `SUMMARY:${escapeIcs(`Termin mit ${CONFIG.companyName}`)}`,
    `DESCRIPTION:${escapeIcs(appointment.description || contact.service || "Termin")}`,
    `LOCATION:${escapeIcs(appointment.location || appointment.meetingUrl || "")}`,
    `ORGANIZER;CN=${escapeIcs(CONFIG.companyName)}:MAILTO:${CONFIG.adminEmail}`,
    `ATTENDEE;CN=${escapeIcs(contact.name)};ROLE=REQ-PARTICIPANT:MAILTO:${contact.email}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
}

function buildGoogleCalendarUrl(contact, appointment) {
  const start = new Date(`${appointment.date}T${appointment.time}:00`);
  const end = new Date(start.getTime() + appointment.durationMinutes * 60000);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Termin mit ${CONFIG.companyName}`,
    dates: `${formatIcsDate(start)}/${formatIcsDate(end)}`,
    details: appointment.description || contact.service || "",
    location: appointment.location || appointment.meetingUrl || ""
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function publicReview(doc) {
  const data = doc.data();
  return {
    id: doc.id,
    name: data.name,
    rating: data.rating,
    text: data.text || "",
    profileImageUrl: data.profileImageUrl || null,
    imageUrl: data.imageUrl || null,
    companyReply: data.companyReply || "",
    publishedAt: data.publishedAt?.toDate?.().toISOString() || null
  };
}

async function calculateReviewSummary() {
  const snapshot = await db.collection("reviews")
    .where("companyId", "==", CONFIG.companyId)
    .where("status", "==", "approved")
    .get();
  const ratings = snapshot.docs.map((doc) => Number(doc.data().rating || 0));
  const count = ratings.length;
  const average = count ? ratings.reduce((sum, rating) => sum + rating, 0) / count : 0;
  return { count, average };
}

function sanitize(value, maxLength) {
  return String(value || "").replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function sanitizeMultiline(value, maxLength) {
  return String(value || "").replace(/<[^>]*>?/gm, "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeIcs(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function hashIp(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function removeUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}
