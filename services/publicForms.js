import { appConfig, callFunction } from "./firebaseClient.js";
import {
  clearFormErrors,
  enforceLocalRateLimit,
  isValidEmail,
  isValidPhone,
  readPublicImageFile,
  sanitizeMultiline,
  sanitizeText,
  setFieldError
} from "../utils/validation.js";

const CONTACT_RATE_WINDOW = 60 * 60 * 1000;
const REVIEW_RATE_WINDOW = 24 * 60 * 60 * 1000;

export function initPublicForms() {
  initContactForm();
  initReviewForm();
  initApprovedReviews();
  initCharacterCounters();
}

function initCharacterCounters() {
  document.querySelectorAll("[data-maxlength]").forEach((field) => {
    const counter = document.querySelector(`[data-counter-for="${field.id}"]`);
    const max = Number(field.dataset.maxlength || field.getAttribute("maxlength") || 0);
    if (!counter || !max) return;

    const update = () => {
      counter.textContent = `${field.value.length}/${max}`;
    };

    field.addEventListener("input", update);
    update();
  });
}

function initContactForm() {
  const form = document.getElementById("contactForm");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    hideFormStatus(form);

    const submitButton = form.querySelector("[type='submit']");
    const payload = {
      name: sanitizeText(form.name.value, 120),
      company: sanitizeText(form.company.value, 120),
      phone: sanitizeText(form.phone.value, 40),
      email: sanitizeText(form.email.value, 160).toLowerCase(),
      service: sanitizeText(form.service.value, 120),
      message: sanitizeMultiline(form.message.value, 1500),
      website: sanitizeText(form.website?.value, 120),
      consent: form.privacyConsent?.checked === true,
      sourcePath: window.location.pathname
    };

    let isValid = true;
    if (!payload.name || payload.name.length < 2) {
      setFieldError(form.name, "Bitte geben Sie Ihren Namen ein.");
      isValid = false;
    }
    if (!payload.phone || !isValidPhone(payload.phone)) {
      setFieldError(form.phone, "Bitte geben Sie eine gueltige Telefonnummer ein.");
      isValid = false;
    }
    if (!payload.email || !isValidEmail(payload.email)) {
      setFieldError(form.email, "Bitte geben Sie eine gueltige E-Mail-Adresse ein.");
      isValid = false;
    }
    if (!payload.service) {
      setFieldError(form.service, "Bitte waehlen Sie einen Service aus.");
      isValid = false;
    }
    if (!payload.message || payload.message.length < 20) {
      setFieldError(form.message, "Bitte beschreiben Sie Ihr Anliegen mit mindestens 20 Zeichen.");
      isValid = false;
    }
    if (!payload.consent) {
      setFieldError(form.privacyConsent, "Bitte bestaetigen Sie die Datenschutzhinweise.");
      isValid = false;
    }

    if (!isValid) return;
    if (!enforceLocalRateLimit("apex_contact_attempts", appConfig.maxContactMessagesPerHour, CONTACT_RATE_WINDOW)) {
      showFormStatus(form, "Bitte warten Sie kurz, bevor Sie eine weitere Anfrage senden.", "error");
      return;
    }

    setLoading(submitButton, true);
    try {
      await callFunction("submitContactRequest", payload);
      form.reset();
      showFormStatus(form, "Vielen Dank. Ihre Anfrage wurde sicher uebermittelt.", "success");
    } catch (error) {
      showFormStatus(form, friendlyFunctionError(error), "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
}

function initReviewForm() {
  const form = document.getElementById("reviewForm");
  if (!form) return;

  const ratingInput = form.rating;
  form.querySelectorAll("[data-rating-value]").forEach((button) => {
    button.addEventListener("click", () => {
      ratingInput.value = button.dataset.ratingValue;
      form.querySelectorAll("[data-rating-value]").forEach((item) => item.classList.toggle("active", Number(item.dataset.ratingValue) <= Number(ratingInput.value)));
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFormErrors(form);
    hideFormStatus(form);

    const submitButton = form.querySelector("[type='submit']");
    const rating = Number(form.rating.value);
    const payload = {
      name: sanitizeText(form.reviewerName.value, 120),
      rating,
      text: sanitizeMultiline(form.reviewText.value, 1000),
      sourcePath: window.location.pathname
    };

    let isValid = true;
    if (!payload.name || payload.name.length < 2) {
      setFieldError(form.reviewerName, "Bitte geben Sie Ihren Namen ein.");
      isValid = false;
    }
    if (!rating || rating < 1 || rating > 5) {
      setFieldError(form.querySelector(".rating-input"), "Bitte waehlen Sie eine Bewertung aus.");
      isValid = false;
    }

    if (!isValid) return;
    if (!enforceLocalRateLimit("apex_review_attempts", appConfig.maxReviewSubmissionsPerDay, REVIEW_RATE_WINDOW)) {
      showFormStatus(form, "Bitte warten Sie, bevor Sie eine weitere Bewertung senden.", "error");
      return;
    }

    setLoading(submitButton, true);
    try {
      payload.profileImage = await readPublicImageFile(form.profileImage.files[0]);
      payload.reviewImage = await readPublicImageFile(form.reviewImage.files[0]);
      await callFunction("submitReview", payload);
      form.reset();
      form.rating.value = "";
      form.querySelectorAll("[data-rating-value]").forEach((item) => item.classList.remove("active"));
      showFormStatus(form, "Vielen Dank. Ihre Bewertung wird nach Pruefung veroeffentlicht.", "success");
    } catch (error) {
      showFormStatus(form, friendlyFunctionError(error), "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
}

async function initApprovedReviews() {
  const list = document.getElementById("reviewsList");
  if (!list) return;

  const summary = document.getElementById("reviewsSummary");
  const sort = document.getElementById("reviewsSort");
  const loadMore = document.getElementById("reviewsLoadMore");
  let cursor = null;
  let order = sort?.value || "newest";

  const load = async (append = false) => {
    list.classList.add("is-loading");
    try {
      const result = await callFunction("listApprovedReviews", { cursor, order, pageSize: 6 });
      const data = result.data || {};
      cursor = data.nextCursor || null;
      if (!append) list.innerHTML = "";
      renderReviews(list, data.reviews || []);
      renderReviewSummary(summary, data.summary);
      if (loadMore) loadMore.hidden = !cursor;
    } catch (error) {
      list.innerHTML = `<div class="empty-state">Bewertungen koennen gerade nicht geladen werden.</div>`;
    } finally {
      list.classList.remove("is-loading");
    }
  };

  sort?.addEventListener("change", () => {
    order = sort.value;
    cursor = null;
    load(false);
  });
  loadMore?.addEventListener("click", () => load(true));
  load(false);
}

function renderReviews(container, reviews) {
  if (!reviews.length && !container.children.length) {
    container.innerHTML = `<div class="empty-state">Noch keine veroeffentlichten Bewertungen.</div>`;
    return;
  }

  const fragment = document.createDocumentFragment();
  reviews.forEach((review) => {
    const card = document.createElement("article");
    card.className = "review-card reveal visible";
    const date = review.publishedAt ? new Date(review.publishedAt).toLocaleDateString("de-DE") : "";
    card.innerHTML = `
      <div class="review-card__header">
        <img src="${review.profileImageUrl || "assets/avatar-placeholder.svg"}" alt="" class="review-card__avatar" loading="lazy">
        <div>
          <h3>${escapeHtml(review.name)}</h3>
          <div class="review-stars" aria-label="${review.rating} von 5 Sternen">${renderStars(review.rating)}</div>
        </div>
        <time>${date}</time>
      </div>
      ${review.text ? `<p>${escapeHtml(review.text)}</p>` : ""}
      ${review.imageUrl ? `<img src="${review.imageUrl}" alt="Bild zur Bewertung" class="review-card__image" loading="lazy">` : ""}
      ${review.companyReply ? `<div class="review-card__reply"><strong>Antwort des Unternehmens</strong><p>${escapeHtml(review.companyReply)}</p></div>` : ""}
    `;
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function renderReviewSummary(container, summary) {
  if (!container || !summary) return;
  container.innerHTML = `
    <strong>${Number(summary.average || 0).toFixed(1)}</strong>
    <span>${summary.count || 0} Bewertungen</span>
  `;
}

function renderStars(rating) {
  const rounded = Math.round(Number(rating) * 2) / 2;
  return Array.from({ length: 5 }, (_, index) => {
    const value = index + 1;
    if (rounded >= value) return '<i class="fas fa-star"></i>';
    if (rounded >= value - 0.5) return '<i class="fas fa-star-half-alt"></i>';
    return '<i class="far fa-star"></i>';
  }).join("");
}

function setLoading(button, isLoading) {
  if (!button) return;
  button.disabled = isLoading;
  button.dataset.originalText ||= button.innerHTML;
  button.innerHTML = isLoading ? '<i class="fas fa-circle-notch fa-spin"></i> Wird gesendet...' : button.dataset.originalText;
}

function showFormStatus(form, message, type) {
  const status = form.querySelector(".form-status");
  if (!status) return;
  status.textContent = message;
  status.className = `form-status form-status--${type} visible`;
}

function hideFormStatus(form) {
  const status = form.querySelector(".form-status");
  if (status) status.className = "form-status";
}

function friendlyFunctionError(error) {
  if (String(error?.message || "").includes("Firebase ist noch nicht konfiguriert")) {
    return "Firebase ist noch nicht verbunden. Bitte pruefen Sie die Projektkonfiguration.";
  }
  return "Die Uebermittlung ist fehlgeschlagen. Bitte versuchen Sie es erneut oder rufen Sie uns an.";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
