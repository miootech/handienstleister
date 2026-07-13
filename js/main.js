/* ========================================
   HAN Dienstleister GmbH - Main JavaScript
   ======================================== */

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initMobileNavigation();
  initHeaderScroll();
  initBackToTop();
  initReveal();
  initOpeningHours();
  initHoursModal();
  initCounters();
  initCookieConsent();
  initExternalEmbeds();

  import("../services/publicForms.js")
    .then((module) => module.initPublicForms())
    .catch(() => {
      const forms = document.querySelectorAll("#contactForm, #reviewForm");
      forms.forEach((form) => {
        const status = form.querySelector(".form-status");
        if (status) {
          status.textContent = "Formulare konnten nicht initialisiert werden. Bitte laden Sie die Seite neu.";
          status.className = "form-status form-status--error visible";
        }
      });
    });
});

function initTheme() {
  const html = document.documentElement;
  const buttons = document.querySelectorAll(".theme-switch");
  const storedTheme = localStorage.getItem("theme");
  const initialTheme = storedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

  html.setAttribute("data-theme", initialTheme);
  updateThemeIcons(buttons, initialTheme);

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const nextTheme = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
      html.setAttribute("data-theme", nextTheme);
      localStorage.setItem("theme", nextTheme);
      updateThemeIcons(buttons, nextTheme);
    });
  });
}

function updateThemeIcons(buttons, theme) {
  buttons.forEach((button) => {
    const icon = button.querySelector("i");
    if (!icon) return;
    icon.className = theme === "dark" ? "fas fa-sun" : "fas fa-moon";
    button.setAttribute("aria-label", theme === "dark" ? "Zum hellen Modus wechseln" : "Zum dunklen Modus wechseln");
  });
}

function initMobileNavigation() {
  const hamburger = document.querySelector(".hamburger");
  const mobileNav = document.querySelector(".mobile-nav");
  const overlay = document.querySelector(".mobile-overlay");
  if (!hamburger || !mobileNav || !overlay) return;

  const close = () => {
    hamburger.classList.remove("active");
    mobileNav.classList.remove("open");
    overlay.classList.remove("visible");
    document.body.style.overflow = "";
  };

  const open = () => {
    hamburger.classList.add("active");
    mobileNav.classList.add("open");
    overlay.classList.add("visible");
    document.body.style.overflow = "hidden";
  };

  hamburger.addEventListener("click", () => (mobileNav.classList.contains("open") ? close() : open()));
  overlay.addEventListener("click", close);
  mobileNav.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });
}

function initHeaderScroll() {
  const header = document.querySelector(".header");
  const backToTop = document.querySelector(".back-to-top");

  const update = () => {
    const scrolled = window.scrollY > 60;
    header?.classList.toggle("scrolled", scrolled);
    backToTop?.classList.toggle("visible", window.scrollY > 500);
  };

  window.addEventListener("scroll", update, { passive: true });
  update();
}

function initBackToTop() {
  document.querySelector(".back-to-top")?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function initReveal() {
  const elements = document.querySelectorAll(".reveal");
  if (!elements.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -80px 0px" }
  );

  elements.forEach((element) => observer.observe(element));
}

function initOpeningHours() {
  const update = () => {
    const state = getOpeningState(new Date());
    document.querySelectorAll(".hours-status").forEach((element) => {
      element.className = `hours-status ${state.isOpen ? "hours-status--open" : "hours-status--closed"}`;
      element.innerHTML = `<span class="hours-status__dot"></span> ${state.isOpen ? "Aktuell geoeffnet" : "Aktuell geschlossen"}`;
    });

    const liveBadge = document.getElementById("liveStatusBadge");
    if (liveBadge) {
      liveBadge.className = `live-status__badge ${state.isOpen ? "live-status__badge--open" : "live-status__badge--closed"}`;
      liveBadge.innerHTML = `<span class="live-status__dot"></span><span>${state.label}</span>`;
    }
  };

  update();
  setInterval(update, 30000);
}

function getOpeningState(now) {
  const day = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const schedule = {
    1: [540, 960],
    2: [540, 960],
    3: [540, 960],
    4: [540, 1080],
    5: [540, 1080]
  };
  const today = schedule[day];
  const isOpen = Boolean(today && minutes >= today[0] && minutes < today[1]);
  const target = isOpen ? getTodayAt(now, today[1]) : getNextOpenTime(now, schedule);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const totalMinutes = Math.ceil(diff / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  const timeLabel = hours > 0 ? `${hours} Std ${remainingMinutes} Min` : `${remainingMinutes} Minuten`;

  if (isOpen) {
    return { isOpen, label: `Aktuell geoeffnet - schliesst in ${timeLabel}` };
  }

  const dayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const dateLabel = target.getDay() === now.getDay() ? "heute" : `am ${dayNames[target.getDay()]}`;
  return {
    isOpen,
    label: `Aktuell geschlossen - oeffnet ${dateLabel} um ${String(target.getHours()).padStart(2, "0")}:00 Uhr`
  };
}

function getTodayAt(date, minutesAfterMidnight) {
  const target = new Date(date);
  target.setHours(Math.floor(minutesAfterMidnight / 60), minutesAfterMidnight % 60, 0, 0);
  return target;
}

function getNextOpenTime(fromDate, schedule) {
  for (let offset = 0; offset < 8; offset += 1) {
    const candidate = new Date(fromDate);
    candidate.setDate(fromDate.getDate() + offset);
    const daySchedule = schedule[candidate.getDay()];
    if (!daySchedule) continue;
    const openTime = getTodayAt(candidate, daySchedule[0]);
    if (openTime > fromDate) return openTime;
  }
  return getTodayAt(fromDate, 540);
}

function initHoursModal() {
  const openButton = document.getElementById("openHoursModal");
  const closeButton = document.getElementById("closeHoursModal");
  const overlay = document.getElementById("hoursModalOverlay");
  if (!openButton || !overlay) return;

  const close = () => {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
  };

  openButton.addEventListener("click", () => {
    overlay.classList.add("active");
    document.body.style.overflow = "hidden";
  });
  closeButton?.addEventListener("click", close);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("active")) close();
  });
}

function initCounters() {
  const counters = document.querySelectorAll("[data-counter]");
  if (!counters.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.4 });

  counters.forEach((counter) => observer.observe(counter));
}

function animateCounter(counter) {
  const target = Number(counter.dataset.counter || 0);
  const suffix = counter.dataset.suffix || "";
  const prefix = counter.dataset.prefix || "";
  const duration = 1600;
  const start = performance.now();

  const step = (timestamp) => {
    const progress = Math.min((timestamp - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    counter.textContent = `${prefix}${Math.floor(eased * target)}${suffix}`;
    if (progress < 1) requestAnimationFrame(step);
    else counter.textContent = `${prefix}${target}${suffix}`;
  };

  requestAnimationFrame(step);
}

function initCookieConsent() {
  const banner = document.querySelector(".cookie-banner");
  if (!banner || localStorage.getItem("han_cookie_consent")) return;

  banner.hidden = false;
  banner.querySelectorAll("[data-cookie-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      localStorage.setItem("han_cookie_consent", button.dataset.cookieChoice);
      banner.hidden = true;
      window.dispatchEvent(new CustomEvent("cookie-consent-updated", { detail: button.dataset.cookieChoice }));
    });
  });
}

function initExternalEmbeds() {
  const embeds = document.querySelectorAll("[data-map-src]");
  if (!embeds.length) return;

  const loadEmbed = (embed) => {
    if (embed.querySelector("iframe")) return;
    const iframe = document.createElement("iframe");
    iframe.src = embed.dataset.mapSrc;
    iframe.width = "100%";
    iframe.height = "380";
    iframe.style.border = "0";
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "no-referrer-when-downgrade";
    iframe.title = "Standort der HAN Dienstleister GmbH";
    embed.replaceChildren(iframe);
  };

  if (localStorage.getItem("han_cookie_consent") === "all") {
    embeds.forEach(loadEmbed);
  }

  embeds.forEach((embed) => {
    embed.querySelector("[data-load-embed]")?.addEventListener("click", () => loadEmbed(embed));
  });

  window.addEventListener("cookie-consent-updated", (event) => {
    if (event.detail === "all") embeds.forEach(loadEmbed);
  });
}
