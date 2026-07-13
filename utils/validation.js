const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const PHONE_PATTERN = /^\+?[0-9\s()/.-]{6,24}$/;
const TAG_PATTERN = /<[^>]*>?/gm;

export function sanitizeText(value, maxLength = 1000) {
  return String(value || "")
    .replace(TAG_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeMultiline(value, maxLength = 2000) {
  return String(value || "")
    .replace(TAG_PATTERN, "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || "").trim());
}

export function isValidPhone(value) {
  return PHONE_PATTERN.test(String(value || "").trim());
}

export function setFieldError(input, message) {
  if (!input) return;
  input.classList.add("error");
  input.setAttribute("aria-invalid", "true");
  const error = input.closest(".form-group")?.querySelector(".form-error");
  if (error) {
    error.textContent = message;
    error.classList.add("visible");
  }
}

export function clearFormErrors(form) {
  form.querySelectorAll(".form-error").forEach((element) => element.classList.remove("visible"));
  form.querySelectorAll(".form-control, .rating-input").forEach((element) => {
    element.classList.remove("error");
    element.removeAttribute("aria-invalid");
  });
}

export function enforceLocalRateLimit(key, maxAttempts, windowMs) {
  const now = Date.now();
  const attempts = JSON.parse(localStorage.getItem(key) || "[]").filter((time) => now - time < windowMs);

  if (attempts.length >= maxAttempts) {
    return false;
  }

  attempts.push(now);
  localStorage.setItem(key, JSON.stringify(attempts));
  return true;
}

export async function readPublicImageFile(file, maxBytes = 2 * 1024 * 1024) {
  if (!file) return null;
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    throw new Error("Bitte laden Sie nur JPG-, PNG- oder WebP-Dateien hoch.");
  }

  if (file.size > maxBytes) {
    throw new Error("Die Datei ist zu gross. Maximal erlaubt sind 2 MB.");
  }

  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  return {
    name: sanitizeText(file.name, 120),
    type: file.type,
    size: file.size,
    dataUrl
  };
}
