import {
  appConfig,
  callFunction,
  collection,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  signInWithEmailAndPassword,
  signOut,
  where
} from "../services/firebaseClient.js";

const state = {
  user: null,
  requests: [],
  reviews: [],
  unsubscribers: []
};

const statusLabels = {
  new: "Neu",
  open: "Offen",
  in_progress: "In Bearbeitung",
  waiting_customer: "Warten auf Kunde",
  accepted: "Angenommen",
  rejected: "Abgelehnt",
  done: "Erledigt",
  archived: "Archiviert",
  pending: "Prüfung",
  approved: "Genehmigt"
};

const panels = {
  overview: "Dashboard",
  requests: "Anfragen",
  reviews: "Bewertungen",
  calendar: "Kalender",
  files: "Dateien",
  company: "Unternehmen",
  users: "Benutzer",
  settings: "Einstellungen",
  stats: "Statistiken"
};

initAdmin();

function initAdmin() {
  initThemeToggle();
  initTabs();
  initLogin();
  initLogout();
  initFilters();
  initAppointmentForm();

  try {
    const { auth } = window.__hanFirebaseServices || {};
    const servicesPromise = import("../services/firebaseClient.js").then((module) => module.getFirebaseServices());
    servicesPromise.then(({ auth }) => {
      onAuthStateChanged(auth, handleAuthState);
    }).catch(showLoginConfigError);
  } catch (error) {
    showLoginConfigError(error);
  }
}

function initThemeToggle() {
  const html = document.documentElement;
  const button = document.querySelector(".theme-switch");
  const initialTheme = localStorage.getItem("theme") || "dark";
  html.setAttribute("data-theme", initialTheme);
  updateThemeButton(button, initialTheme);
  button?.addEventListener("click", () => {
    const nextTheme = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    html.setAttribute("data-theme", nextTheme);
    localStorage.setItem("theme", nextTheme);
    updateThemeButton(button, nextTheme);
  });
}

function updateThemeButton(button, theme) {
  const icon = button?.querySelector("i");
  if (icon) icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
}

function initLogin() {
  const form = document.getElementById("loginForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".form-status");
    status.className = "form-status";
    try {
      const { auth } = await import("../services/firebaseClient.js").then((module) => module.getFirebaseServices());
      await signInWithEmailAndPassword(auth, form.email.value.trim(), form.password.value);
    } catch (error) {
      status.textContent = "Login fehlgeschlagen. Bitte Zugangsdaten prüfen.";
      status.className = "form-status form-status--error visible";
    }
  });
}

function initLogout() {
  document.getElementById("logoutButton")?.addEventListener("click", async () => {
    const { auth } = await import("../services/firebaseClient.js").then((module) => module.getFirebaseServices());
    await signOut(auth);
  });
}

async function handleAuthState(user) {
  clearSubscriptions();
  state.user = user;
  document.getElementById("loginView").hidden = Boolean(user);
  document.getElementById("dashboardView").hidden = !user;

  if (!user) return;
  const token = await user.getIdTokenResult(true);
  const role = token.claims.role || "companyAdmin";
  document.getElementById("adminRole").textContent = role === "superAdmin" ? "Super Admin" : "Company Admin";
  subscribeDashboardData();
}

async function subscribeDashboardData() {
  const { db } = await import("../services/firebaseClient.js").then((module) => module.getFirebaseServices());
  const requestsQuery = query(
    collection(db, "contactRequests"),
    where("companyId", "==", appConfig.companyId),
    orderBy("createdAt", "desc"),
    limit(80)
  );
  const reviewsQuery = query(
    collection(db, "reviews"),
    where("companyId", "==", appConfig.companyId),
    orderBy("createdAt", "desc"),
    limit(80)
  );

  state.unsubscribers.push(onSnapshot(requestsQuery, (snapshot) => {
    state.requests = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderAll();
  }));
  state.unsubscribers.push(onSnapshot(reviewsQuery, (snapshot) => {
    state.reviews = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderAll();
  }));
}

function renderAll() {
  renderMetrics();
  renderRequestLists();
  renderReviewLists();
  renderAppointmentOptions();
  renderStats();
}

function renderMetrics() {
  setText("metricNewRequests", state.requests.filter((item) => item.status === "new").length);
  setText("metricOpenRequests", state.requests.filter((item) => ["open", "in_progress", "waiting_customer"].includes(item.status)).length);
  setText("metricPendingReviews", state.reviews.filter((item) => item.status === "pending").length);
  const approved = state.reviews.filter((item) => item.status === "approved");
  const average = approved.length ? approved.reduce((sum, item) => sum + Number(item.rating || 0), 0) / approved.length : 0;
  setText("metricAverageRating", average.toFixed(1));
}

function renderRequestLists() {
  const filter = document.getElementById("requestStatusFilter")?.value || "";
  const requests = filter ? state.requests.filter((item) => item.status === filter) : state.requests;
  document.getElementById("requestsList").innerHTML = requests.map(renderRequestItem).join("") || empty("Keine Anfragen gefunden.");
  document.getElementById("recentRequests").innerHTML = state.requests.slice(0, 5).map(renderRequestItem).join("") || empty("Noch keine Anfragen.");
  bindRequestActions();
}

function renderRequestItem(item) {
  return `
    <article class="admin-item">
      <div class="admin-item__header">
        <div><h3>${escapeHtml(item.name)} ${item.company ? `<span class="admin-muted">- ${escapeHtml(item.company)}</span>` : ""}</h3><p>${escapeHtml(item.service || "")}</p></div>
        <span class="status-pill">${statusLabels[item.status] || item.status}</span>
      </div>
      <p>${escapeHtml(item.message || "").slice(0, 260)}</p>
      <p><strong>${escapeHtml(item.phone || "")}</strong> · <a href="mailto:${escapeHtml(item.email || "")}">${escapeHtml(item.email || "")}</a></p>
      <div class="admin-actions" data-request-id="${item.id}">
        ${["open", "in_progress", "waiting_customer", "accepted", "rejected", "done", "archived"].map((status) => `<button class="btn btn--secondary btn--sm" data-status="${status}">${statusLabels[status]}</button>`).join("")}
      </div>
    </article>`;
}

function bindRequestActions() {
  document.querySelectorAll("[data-request-id] [data-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.closest("[data-request-id]").dataset.requestId;
      await callFunction("updateRequestStatus", { id, status: button.dataset.status });
    });
  });
}

function renderReviewLists() {
  const pending = state.reviews.filter((item) => item.status === "pending");
  document.getElementById("recentReviews").innerHTML = pending.slice(0, 5).map(renderReviewItem).join("") || empty("Keine offenen Bewertungen.");
  document.getElementById("adminReviewsList").innerHTML = state.reviews.map(renderReviewItem).join("") || empty("Noch keine Bewertungen.");
  bindReviewActions();
}

function renderReviewItem(item) {
  return `
    <article class="admin-item">
      <div class="admin-item__header">
        <div><h3>${escapeHtml(item.name)}</h3><p>${Number(item.rating || 0).toFixed(1)} / 5 Sterne</p></div>
        <span class="status-pill">${statusLabels[item.status] || item.status}</span>
      </div>
      <p>${escapeHtml(item.text || "-")}</p>
      <div class="form-group"><label>Antwort des Unternehmens</label><textarea class="form-control" data-review-reply="${item.id}" maxlength="1000">${escapeHtml(item.companyReply || "")}</textarea></div>
      <div class="admin-actions" data-review-id="${item.id}">
        <button class="btn btn--primary btn--sm" data-review-status="approved"><i class="fas fa-check"></i> Genehmigen</button>
        <button class="btn btn--secondary btn--sm" data-review-status="rejected"><i class="fas fa-times"></i> Ablehnen</button>
        <button class="btn btn--secondary btn--sm" data-review-status="pending"><i class="fas fa-pen"></i> Speichern</button>
      </div>
    </article>`;
}

function bindReviewActions() {
  document.querySelectorAll("[data-review-id] [data-review-status]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.closest("[data-review-id]").dataset.reviewId;
      const review = state.reviews.find((item) => item.id === id);
      const reply = document.querySelector(`[data-review-reply="${id}"]`)?.value || "";
      await callFunction("moderateReview", {
        id,
        status: button.dataset.reviewStatus,
        rating: review?.rating,
        text: review?.text || "",
        companyReply: reply
      });
    });
  });
}

function renderAppointmentOptions() {
  const select = document.getElementById("appointmentRequest");
  if (!select) return;
  const selected = select.value;
  const options = state.requests
    .filter((item) => !["rejected", "archived"].includes(item.status))
    .map((item) => `<option value="${item.id}">${escapeHtml(item.name)} - ${escapeHtml(item.service || "Anfrage")}</option>`)
    .join("");
  select.innerHTML = options || "<option value=''>Keine passenden Anfragen</option>";
  if (selected) select.value = selected;
}

function initAppointmentForm() {
  const form = document.getElementById("appointmentForm");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = form.querySelector(".form-status");
    status.className = "form-status";
    try {
      await callFunction("confirmAppointment", {
        requestId: form.requestId.value,
        date: form.date.value,
        time: form.time.value,
        durationMinutes: Number(form.durationMinutes.value),
        location: form.location.value,
        meetingUrl: form.meetingUrl.value,
        contactPerson: form.contactPerson.value,
        description: form.description.value
      });
      status.textContent = "Termin bestätigt und E-Mail versendet.";
      status.className = "form-status form-status--success visible";
    } catch (error) {
      status.textContent = "Termin konnte nicht bestätigt werden.";
      status.className = "form-status form-status--error visible";
    }
  });
}

function initTabs() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.adminTab;
      document.querySelectorAll("[data-admin-tab]").forEach((item) => item.classList.toggle("active", item === button));
      document.querySelectorAll("[data-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab));
      setText("adminTitle", panels[tab] || "Dashboard");
    });
  });
}

function initFilters() {
  document.getElementById("requestStatusFilter")?.addEventListener("change", renderRequestLists);
}

function renderStats() {
  const target = document.getElementById("statsOutput");
  if (!target) return;
  const byStatus = state.requests.reduce((acc, item) => {
    acc[item.status] = (acc[item.status] || 0) + 1;
    return acc;
  }, {});
  target.innerHTML = Object.entries(byStatus).map(([status, count]) => `<div><strong>${statusLabels[status] || status}:</strong> ${count}</div>`).join("") || "Noch keine Daten.";
}

function clearSubscriptions() {
  state.unsubscribers.forEach((unsubscribe) => unsubscribe());
  state.unsubscribers = [];
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function empty(text) {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

function showLoginConfigError() {
  const status = document.querySelector("#loginForm .form-status");
  if (!status) return;
  status.textContent = "Firebase ist noch nicht konfiguriert. Bitte firebaseConfig.js ausfüllen.";
  status.className = "form-status form-status--error visible";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
