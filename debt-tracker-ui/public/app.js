const protectedRoutes = new Set(["/dashboard", "/customers", "/debts", "/payments", "/reminders", "/calendar", "/reports", "/settings", "/logs"]);
const publicRoutes = new Set(["/", "/login", "/register"]);
const pageByRoute = {
  "/dashboard": "dashboard",
  "/customers": "customers",
  "/debts": "debts",
  "/payments": "payments",
  "/reminders": "reminders",
  "/calendar": "calendar",
  "/reports": "reports",
  "/settings": "settings",
  "/logs": "logs"
};
const state = { data: null, config: null, session: null, page: "dashboard", search: "", exchange: null };

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const currencyOptions = [
  { value: "NGN", label: "Nigeria - Naira (NGN)", symbol: "₦" },
  { value: "GHS", label: "Ghana - Cedi (GHS)", symbol: "GH₵" },
  { value: "KES", label: "Kenya - Shilling (KES)", symbol: "KSh" },
  { value: "ZAR", label: "South Africa - Rand (ZAR)", symbol: "R" },
  { value: "EGP", label: "Egypt - Pound (EGP)", symbol: "E£" },
  { value: "XOF", label: "West Africa CFA (XOF)", symbol: "CFA" },
  { value: "XAF", label: "Central Africa CFA (XAF)", symbol: "FCFA" },
  { value: "TZS", label: "Tanzania - Shilling (TZS)", symbol: "TSh" },
  { value: "UGX", label: "Uganda - Shilling (UGX)", symbol: "USh" },
  { value: "MAD", label: "Morocco - Dirham (MAD)", symbol: "DH" }
];
const fallbackRates = {
  USD: 1,
  NGN: 1500,
  GHS: 14.5,
  KES: 129,
  ZAR: 18.2,
  EGP: 47.5,
  XOF: 600,
  XAF: 600,
  TZS: 2600,
  UGX: 3700,
  MAD: 10
};
const currencyMeta = (code = state.data?.business?.currency) => currencyOptions.find((option) => option.value === code) || currencyOptions[0];
const baseCurrency = () => state.data?.business?.baseCurrency || "NGN";
const displayCurrency = () => state.data?.business?.currency || baseCurrency();
const rates = () => state.exchange?.rates || fallbackRates;
const rateFor = (code) => Number(rates()[code] || fallbackRates[code] || 1);
const convertAmount = (amount, fromCode, toCode) => {
  const value = Number(amount || 0);
  if (fromCode === toCode) return value;
  return (value / rateFor(fromCode)) * rateFor(toCode);
};
const toBaseAmount = (amount) => convertAmount(amount, displayCurrency(), baseCurrency());
const money = (value) => {
  const meta = currencyMeta();
  const converted = convertAmount(value, baseCurrency(), displayCurrency());
  return `${meta.value} ${meta.symbol}${converted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (value) => value ? new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "-";
const initials = (name = "") => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "??";

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}

async function load() {
  state.config = await api("/api/config");
  state.session = await api("/api/auth/session");
  await loadExchangeRates();
  await renderRoute(location.pathname);
}

async function loadExchangeRates() {
  const cached = localStorage.getItem("debttrack_exchange_rates");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.rates) state.exchange = { ...parsed, live: false, cached: true };
    } catch {
      localStorage.removeItem("debttrack_exchange_rates");
    }
  }

  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD", { cache: "no-store" });
    if (!response.ok) throw new Error("Exchange rate service is unavailable");
    const payload = await response.json();
    if (payload.result && payload.result !== "success") throw new Error("Exchange rates failed to load");
    const needed = ["USD", ...currencyOptions.map((option) => option.value)];
    const nextRates = Object.fromEntries(needed.map((code) => [code, Number(payload.rates?.[code] || fallbackRates[code])]));
    state.exchange = { base: "USD", rates: nextRates, live: true, fetchedAt: new Date().toISOString() };
    localStorage.setItem("debttrack_exchange_rates", JSON.stringify(state.exchange));
  } catch (error) {
    state.exchange ||= { base: "USD", rates: fallbackRates, live: false, error: error.message };
    state.exchange.error = error.message;
    setTimeout(() => toast("Live exchange rates failed to load. Using saved/fallback rates."), 300);
  }
}

function exchangeStatusText() {
  if (state.exchange?.live) return `Live rates active. Last updated ${new Date(state.exchange.fetchedAt).toLocaleTimeString()}.`;
  if (state.exchange?.cached) return "Using saved exchange rates. Live rates could not refresh.";
  return "Using fallback exchange rates until live rates load.";
}

function initGoogleSignIn(targetSelector = "#googleSignIn", fallbackSelector = "#googleFallback") {
  const fallback = $(fallbackSelector);
  const target = $(targetSelector);
  if (!state.config?.googleClientId || !target) {
    fallback?.classList.remove("hidden");
    return;
  }

  const renderGoogleButton = () => {
    if (!window.google?.accounts?.id) {
      fallback?.classList.remove("hidden");
      return;
    }
    window.google.accounts.id.initialize({
      client_id: state.config.googleClientId,
      callback: handleGoogleCredential
    });
    target.innerHTML = "";
    window.google.accounts.id.renderButton(target, {
      theme: "filled_black",
      size: "large",
      type: "standard",
      shape: "rectangular",
      text: "signin_with",
      logo_alignment: "left"
    });
    fallback?.classList.add("hidden");
  };

  if (window.google?.accounts?.id) renderGoogleButton();
  else {
    fallback?.classList.remove("hidden");
    window.addEventListener("load", renderGoogleButton, { once: true });
    setTimeout(renderGoogleButton, 1200);
  }
}

async function handleGoogleCredential(response) {
  try {
    state.session = await api("/api/auth/google", {
      method: "POST",
      body: { credential: response.credential }
    });
    toast("Signed in with Google");
    await navigate("/dashboard", true);
  } catch (error) {
    toast(error.message);
  }
}

async function renderRoute(pathname) {
  const path = publicRoutes.has(pathname) || protectedRoutes.has(pathname) ? pathname : "/";
  if (protectedRoutes.has(path) && !state.session?.authenticated) {
    history.replaceState(null, "", "/login");
    return renderPublic("login");
  }

  if (state.session?.authenticated && (path === "/login" || path === "/register")) {
    history.replaceState(null, "", "/dashboard");
    return renderProtected("dashboard");
  }

  if (path === "/") {
    history.replaceState(null, "", "/login");
    return renderPublic("login");
  }
  if (path === "/login") return renderPublic("login");
  if (path === "/register") return renderPublic("register");
  return renderProtected(pageByRoute[path] || "dashboard");
}

async function navigate(path, replace = false) {
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  await renderRoute(path);
}

function showPublicShell() {
  document.body.classList.add("public-mode");
  $("#publicShell").classList.remove("hidden");
  $("#appShell").classList.add("hidden");
}

function showAppShell() {
  document.body.classList.remove("public-mode");
  $("#publicShell").classList.add("hidden");
  $("#appShell").classList.remove("hidden");
}

function renderPublic(type) {
  showPublicShell();
  state.data = null;
  const page = $("#publicPage");
  const isRegister = type === "register";
  page.innerHTML = `
    <section class="auth-wrap">
      <div class="auth-card">
        <h1>${isRegister ? "Create your account" : "Welcome back"}</h1>
        <p>${isRegister ? "Start tracking customers, debt, payments, and reminders." : "Sign in to continue to your protected dashboard."}</p>
        <div id="authGoogleSignIn" class="google-auth-slot"></div>
        <button class="btn secondary hidden" id="authGoogleFallback" data-action="google-login">Sign in with Google</button>
        <div class="divider"><span>or use email</span></div>
        <form class="auth-form" id="${isRegister ? "registerForm" : "loginForm"}">
          ${isRegister ? `<label class="field"><span>Name</span><input name="name" autocomplete="name" required></label>` : ""}
          <label class="field"><span>Email</span><input name="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${isRegister ? "new-password" : "current-password"}" required></label>
          <button class="btn" type="submit">${isRegister ? "Create Account" : "Login"}</button>
        </form>
        <div class="auth-link-row">
          <a href="#" data-action="forgot-password">Forgot Password?</a>
          <a href="${isRegister ? "/login" : "/register"}" data-route="${isRegister ? "/login" : "/register"}">${isRegister ? "Have an account? Login" : "Need an account? Sign Up"}</a>
        </div>
      </div>
    </section>`;
  initGoogleSignIn("#authGoogleSignIn", "#authGoogleFallback");
}

async function renderProtected(page) {
  showAppShell();
  if (!state.data) {
    state.data = await api("/api/state");
    state.data.business.baseCurrency ||= state.data.business.currency || "NGN";
    state.data.business.currency ||= state.data.business.baseCurrency;
  }
  setPage(page, true);
}

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2200);
}

function customer(id) {
  return state.data.customers.find((item) => item.id === id) || { name: "Unknown", phone: "" };
}

function debt(id) {
  return state.data.debts.find((item) => item.id === id);
}

function filteredCustomers() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.data.customerSummaries;
  return state.data.customerSummaries.filter((c) => [c.name, c.email, c.phone, c.status].join(" ").toLowerCase().includes(query));
}

function setPage(page, skipHistory = false) {
  state.page = page;
  $$(".page").forEach((el) => el.classList.toggle("active", el.id === page));
  $$(".nav-item").forEach((el) => el.classList.toggle("active", el.dataset.page === page));
  const titles = {
    dashboard: ["Dashboard", "Track debt, payments, reminders, and collection work."],
    customers: ["Customers", "Manage customer profiles and balances."],
    debts: ["Debts", "Create debts, monitor due dates, and attach proof names."],
    payments: ["Payments", "Record partial or full payments and generate receipts."],
    reminders: ["Reminders", "Schedule and send WhatsApp collection reminders."],
    calendar: ["Calendar", "Manage follow-ups that can sync to Google Calendar."],
    reports: ["Reports", "Review collection performance and export data."],
    settings: ["Settings", "Connect integrations and configure business defaults."],
    logs: ["Logs", "Audit trail for backend actions."]
  };
  $("#pageTitle").textContent = titles[page][0];
  $("#pageSubtitle").textContent = titles[page][1];
  const nextPath = page === "dashboard" ? "/dashboard" : `/${page}`;
  if (!skipHistory && location.pathname !== nextPath) history.pushState(null, "", nextPath);
  render();
}

function render() {
  if (!state.data) return;
  renderUser();
  renderDashboard();
  renderCustomers();
  renderDebts();
  renderPayments();
  renderReminders();
  renderCalendar();
  renderReports();
  renderSettings();
  renderLogs();
}

function renderUser() {
  const user = state.data.user;
  $("#userName").textContent = user?.name || "Guest Host";
  $("#userEmail").textContent = user?.email || "Not signed in";
  $("#avatar").textContent = initials(user?.name || "Guest Host");
}

function metric(label, value, hint = "") {
  return `<div class="card metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint">${hint}</div></div>`;
}

function statusPill(status) {
  return `<span class="pill ${status}">${status}</span>`;
}

function renderDashboard() {
  const m = state.data.metrics;
  const upcoming = [...state.data.reminders].filter((r) => r.status === "scheduled").slice(0, 5);
  const recentDebts = [...state.data.debts].slice(0, 5);
  const chartMax = Math.max(m.totalDebt, m.recovered, m.overdue, 1);
  $("#dashboard").innerHTML = `
    <div class="grid metric-grid">
      ${metric("Total Customers", m.totalCustomers, "Active profiles")}
      ${metric("Outstanding", money(m.outstanding), "Still owed")}
      ${metric("Recovered", money(m.recovered), `${m.recoveryRate}% recovery rate`)}
      ${metric("Overdue", money(m.overdue), "Needs attention")}
      ${metric("Today", money(m.collectedToday), "Collected today")}
    </div>
    <div class="grid two-col" style="margin-top:14px">
      <div class="card">
        <h3>Debt Overview</h3>
        <div class="chart-bars">
          ${bar("Total debt", m.totalDebt, chartMax, "var(--blue)")}
          ${bar("Recovered", m.recovered, chartMax, "var(--green)")}
          ${bar("Overdue", m.overdue, chartMax, "var(--red)")}
          ${bar("Outstanding", m.outstanding, chartMax, "var(--amber)")}
        </div>
      </div>
      <div class="card">
        <h3>Integrations</h3>
        ${integrationLine("Google Account", state.data.integrations.google)}
        ${integrationLine("Google Calendar", state.data.integrations.calendar)}
        ${integrationLine("WhatsApp", state.data.integrations.whatsapp)}
        <button class="btn secondary" data-page-link="settings">Manage Integrations</button>
      </div>
    </div>
    <div class="grid two-col" style="margin-top:14px">
      <div class="card">
        <div class="toolbar"><h3>Recent Debts</h3><button class="btn secondary" data-page-link="debts">View all</button></div>
        ${debtTable(recentDebts)}
      </div>
      <div class="card">
        <div class="toolbar"><h3>Upcoming Reminders</h3><button class="btn secondary" data-page-link="reminders">View all</button></div>
        ${upcoming.length ? upcoming.map(reminderCard).join("") : `<div class="empty">No reminders scheduled.</div>`}
      </div>
    </div>`;
}

function bar(label, value, max, color) {
  return `<div class="bar"><span class="muted">${label}</span><div class="track"><div class="fill" style="width:${Math.max(4, (value / max) * 100)}%;background:${color}"></div></div><strong class="amount">${money(value)}</strong></div>`;
}

function countBar(label, value, max, color) {
  const labelText = `${value} ${value === 1 ? "debt" : "debts"}`;
  return `<div class="bar"><span class="muted">${label}</span><div class="track"><div class="fill" style="width:${Math.max(4, (value / max) * 100)}%;background:${color}"></div></div><strong class="amount">${labelText}</strong></div>`;
}

function integrationLine(name, item) {
  const status = item.connected ? "connected" : "disconnected";
  return `<div class="toolbar"><span>${name}</span>${statusPill(status)}</div>`;
}

function renderCustomers() {
  const rows = filteredCustomers();
  $("#customers").innerHTML = `
    <div class="toolbar">
      <div class="left">
        <button class="btn" data-action="add-customer">Add Customer</button>
        <button class="btn secondary" data-action="export-customers">Export CSV</button>
      </div>
      <div class="right"><span class="muted">${rows.length} shown</span></div>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Customer</th><th>Phone</th><th>Total Debt</th><th>Paid</th><th>Balance</th><th>Last Payment</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows.map(customerRow).join("") || `<tr><td colspan="8">No customers found.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function customerRow(c) {
  return `<tr>
    <td><strong>${c.name}</strong><div class="muted">${c.email || "-"}</div></td>
    <td>${c.phone}</td>
    <td class="amount">${money(c.totalDebt)}</td>
    <td class="amount">${money(c.paid)}</td>
    <td class="amount">${money(c.balance)}</td>
    <td>${fmtDate(c.lastPayment)}</td>
    <td>${statusPill(c.status)}</td>
    <td><div class="row-actions">
      <button class="icon-btn" title="Edit" data-action="edit-customer" data-id="${c.id}">Edit</button>
      <button class="icon-btn" title="Debt" data-action="add-debt" data-customer-id="${c.id}">Debt</button>
      <button class="icon-btn" title="Delete" data-action="delete-customer" data-id="${c.id}">Del</button>
    </div></td>
  </tr>`;
}

function renderDebts() {
  $("#debts").innerHTML = `
    <div class="toolbar"><button class="btn" data-action="add-debt">Add Debt</button><button class="btn secondary" data-action="add-upload">Add Proof Upload</button></div>
    <div class="card">${debtTable(state.data.debts, true)}</div>`;
}

function debtTable(debts, actions = false) {
  return `<table>
    <thead><tr><th>Customer</th><th>Description</th><th>Amount</th><th>Paid</th><th>Balance</th><th>Due</th><th>Status</th>${actions ? "<th>Actions</th>" : ""}</tr></thead>
    <tbody>${debts.map((d) => `<tr>
      <td>${customer(d.customerId).name}</td>
      <td>${d.description || "-"}<div class="muted">${d.proof ? `Proof: ${d.proof}` : "No proof attached"}</div></td>
      <td class="amount">${money(d.amount)}</td>
      <td class="amount">${money(d.paid)}</td>
      <td class="amount">${money(Math.max(d.amount - d.paid, 0))}</td>
      <td>${fmtDate(d.dueDate)}</td>
      <td>${statusPill(d.status)}</td>
      ${actions ? `<td><div class="row-actions"><button class="icon-btn" data-action="record-payment" data-debt-id="${d.id}">Pay</button><button class="icon-btn" data-action="schedule-reminder" data-debt-id="${d.id}">Remind</button><button class="icon-btn" data-action="delete-debt" data-id="${d.id}">Del</button></div></td>` : ""}
    </tr>`).join("") || `<tr><td colspan="${actions ? 8 : 7}">No debts yet.</td></tr>`}</tbody>
  </table>`;
}

function renderPayments() {
  $("#payments").innerHTML = `
    <div class="toolbar"><button class="btn" data-action="record-payment">Record Payment</button></div>
    <div class="card">
      <table>
        <thead><tr><th>Receipt</th><th>Customer</th><th>Debt</th><th>Amount</th><th>Method</th><th>Date</th><th>Note</th></tr></thead>
        <tbody>${state.data.payments.map((p) => `<tr><td>${p.receiptNo}</td><td>${customer(p.customerId).name}</td><td>${debt(p.debtId)?.description || "-"}</td><td class="amount">${money(p.amount)}</td><td>${p.method}</td><td>${fmtDate(p.paidAt)}</td><td>${p.note || "-"}</td></tr>`).join("") || `<tr><td colspan="7">No payments recorded.</td></tr>`}</tbody>
      </table>
    </div>`;
}

function renderReminders() {
  $("#reminders").innerHTML = `
    <div class="toolbar"><button class="btn" data-action="schedule-reminder">Schedule Reminder</button></div>
    <div class="grid two-col">${state.data.reminders.map(reminderCard).join("") || `<div class="empty">No reminders.</div>`}</div>`;
}

function reminderCard(r) {
  return `<div class="card">
    <div class="toolbar"><strong>${customer(r.customerId).name}</strong>${statusPill(r.status)}</div>
    <p>${r.message}</p>
    <p class="muted">${r.channel} - ${r.tone} - ${fmtDate(r.scheduledFor)}</p>
    <div class="row-actions">
      <button class="btn secondary" data-action="send-reminder" data-id="${r.id}" ${r.status === "sent" ? "disabled" : ""}>Send Now</button>
      <button class="btn secondary" data-action="calendar-from-reminder" data-id="${r.id}">Add Calendar Event</button>
      <button class="btn danger" data-action="delete-reminder" data-id="${r.id}">Delete</button>
    </div>
  </div>`;
}

function renderCalendar() {
  $("#calendar").innerHTML = `
    <div class="toolbar">
      <div class="left"><button class="btn" data-action="add-event">Add Event</button><button class="btn secondary" data-action="connect-calendar">Connect Google Calendar</button></div>
      ${statusPill(state.data.integrations.calendar.connected ? "connected" : "disconnected")}
    </div>
    <div class="card calendar-list">${state.data.calendarEvents.map((event) => `<div class="calendar-item"><strong>${fmtDate(event.date)} ${event.time}</strong><span>${event.title}<div class="muted">${event.customerId ? customer(event.customerId).name : "Business event"} - ${event.source}</div></span><button class="icon-btn" data-action="delete-event" data-id="${event.id}">Del</button></div>`).join("") || `<div class="empty">No calendar events.</div>`}</div>`;
}

function renderReports() {
  const m = state.data.metrics;
  const overdueCount = state.data.debts.filter((d) => d.status === "overdue").length;
  $("#reports").innerHTML = `
    <div class="grid metric-grid">
      ${metric("Recovery Rate", `${m.recoveryRate}%`, "Paid against total")}
      ${metric("Outstanding", money(m.outstanding), "Current balance")}
      ${metric("Overdue Debts", overdueCount, "Debt records")}
      ${metric("Scheduled Reminders", m.activeReminders, "Pending sends")}
      ${metric("Collected Today", money(m.collectedToday), "Same-day cash")}
    </div>
    <div class="card" style="margin-top:14px">
      <h3>Aging Summary</h3>
      <div class="chart-bars">
        ${countBar("Paid", state.data.debts.filter((d) => d.status === "paid").length, Math.max(state.data.debts.length, 1), "var(--green)")}
        ${countBar("Partial", state.data.debts.filter((d) => d.status === "partial").length, Math.max(state.data.debts.length, 1), "var(--amber)")}
        ${countBar("Overdue", overdueCount, Math.max(state.data.debts.length, 1), "var(--red)")}
        ${countBar("Unpaid", state.data.debts.filter((d) => d.status === "unpaid").length, Math.max(state.data.debts.length, 1), "var(--blue)")}
      </div>
    </div>`;
}

function renderSettings() {
  const i = state.data.integrations;
  $("#settings").innerHTML = `
    <div class="grid two-col">
      <div class="card">
        <h3>Business Settings</h3>
        <div class="form-grid">
          <label class="field" for="businessName"><span>Business name</span><input id="businessName" value="${state.data.business.name}"></label>
          <label class="field" for="businessCurrency"><span>Currency</span><select id="businessCurrency">${currencyOptions.map((option) => `<option value="${option.value}">${option.label}</option>`).join("")}</select></label>
          <label class="field"><span>Base currency</span><input value="${baseCurrency()}" disabled></label>
          <label class="field" for="reminderTone"><span>Reminder tone</span><select id="reminderTone"><option>Friendly</option><option>Polite</option><option>Firm</option></select></label>
          <label class="field" for="defaultReminderDays"><span>Default reminder days</span><input id="defaultReminderDays" type="text" value="${state.data.business.defaultReminderDays}"></label>
          <div class="field full"><span>Exchange rates</span><div class="rate-status ${state.exchange?.live ? "connected" : "scheduled"}">${exchangeStatusText()}</div></div>
          <div class="field"><span>&nbsp;</span><button class="btn" data-action="save-settings">Save Settings</button></div>
        </div>
      </div>
      <div class="card">
        <h3>Integrations</h3>
        ${integrationControl("google", "Google Account", i.google)}
        ${integrationControl("calendar", "Google Calendar", i.calendar)}
        ${integrationControl("whatsapp", "WhatsApp Business", i.whatsapp)}
        ${integrationControl("email", "Email Service", i.email)}
      </div>
    </div>`;
  $("#reminderTone").value = state.data.business.reminderTone;
  $("#businessCurrency").value = state.data.business.currency || "NGN";
}

function integrationControl(key, label, item) {
  return `<div class="toolbar"><span>${label} ${statusPill(item.connected ? "connected" : "disconnected")}</span><button class="btn secondary" data-action="${item.connected ? "disconnect" : "connect"}-integration" data-key="${key}">${item.connected ? "Disconnect" : "Connect"}</button></div>`;
}

function renderLogs() {
  $("#logs").innerHTML = `<div class="card"><h3>Audit Log</h3><div class="log-list">${state.data.auditLogs.map((l) => `<div class="log-item"><span>${new Date(l.createdAt).toLocaleString()}</span><span><strong>${l.action}</strong><br>${l.detail}</span></div>`).join("")}</div></div>`;
}

function openModal(title, fields, onSubmit) {
  $("#modalTitle").textContent = title;
  $("#modalFields").innerHTML = fields.map(fieldHtml).join("");
  $("#modalForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData($("#modalForm")).entries());
    try {
      state.data = await onSubmit(data);
      $("#modal").close();
      render();
      toast(`${title} saved`);
    } catch (error) {
      toast(error.message);
    }
  };
  $("#modal").showModal();
}

function fieldHtml(f) {
  const full = f.full ? " full" : "";
  const required = f.required ? " required" : "";
  if (f.type === "select") {
    return `<label class="field${full}"><span>${f.label}</span><select name="${f.name}"${required}>${f.options.map((o) => `<option value="${o.value}" ${o.value === f.value ? "selected" : ""}>${o.label}</option>`).join("")}</select></label>`;
  }
  if (f.type === "textarea") {
    return `<label class="field${full}"><span>${f.label}</span><textarea name="${f.name}"${required}>${f.value || ""}</textarea></label>`;
  }
  const browserFriendlyType = ["number", "date", "time", "email"].includes(f.type) ? "text" : (f.type || "text");
  return `<label class="field${full}"><span>${f.label}</span><input name="${f.name}" type="${browserFriendlyType}" value="${f.value || ""}"${required}></label>`;
}

const customerOptions = () => state.data.customers.map((c) => ({ value: c.id, label: c.name }));
const debtOptions = () => state.data.debts.filter((d) => d.status !== "paid").map((d) => ({ value: d.id, label: `${customer(d.customerId).name} - ${d.description || "Debt"} (${money(Math.max(d.amount - d.paid, 0))})` }));

function addCustomer(existing) {
  openModal(existing ? "Edit Customer" : "Add Customer", [
    { name: "name", label: "Name", required: true, value: existing?.name },
    { name: "phone", label: "Phone", required: true, value: existing?.phone },
    { name: "email", label: "Email", value: existing?.email },
    { name: "notes", label: "Notes", type: "textarea", full: true, value: existing?.notes }
  ], (data) => existing ? api(`/api/customers/${existing.id}`, { method: "PUT", body: data }) : api("/api/customers", { method: "POST", body: data }));
}

function addDebt(customerId, existing) {
  if (!state.data.customers.length) {
    toast("Add a customer first, then create a debt for them.");
    return addCustomer();
  }
  openModal(existing ? "Edit Debt" : "Add Debt", [
    { name: "customerId", label: "Customer", type: "select", options: customerOptions(), value: customerId || existing?.customerId, required: true, full: true },
    { name: "amount", label: `Amount (${displayCurrency()})`, type: "number", value: existing ? convertAmount(existing.amount, baseCurrency(), displayCurrency()).toFixed(2) : "", required: true },
    { name: "dueDate", label: "Due Date", type: "date", value: existing?.dueDate || today(), required: true },
    { name: "proof", label: "Proof file name", value: existing?.proof },
    { name: "description", label: "Description", type: "textarea", full: true, value: existing?.description }
  ], (data) => {
    data.amount = toBaseAmount(data.amount);
    return existing ? api(`/api/debts/${existing.id}`, { method: "PUT", body: data }) : api("/api/debts", { method: "POST", body: data });
  });
}

function recordPayment(debtId) {
  openModal("Record Payment", [
    { name: "debtId", label: "Debt", type: "select", options: debtOptions(), value: debtId, required: true },
    { name: "amount", label: `Amount (${displayCurrency()})`, type: "number", required: true },
    { name: "method", label: "Method", type: "select", options: ["Cash", "Bank Transfer", "Card", "Mobile Money", "Other"].map((x) => ({ value: x, label: x })), required: true },
    { name: "paidAt", label: "Paid Date", type: "date", value: today(), required: true },
    { name: "note", label: "Note", type: "textarea", full: true }
  ], (data) => {
    data.amount = toBaseAmount(data.amount);
    return api("/api/payments", { method: "POST", body: data });
  });
}

function scheduleReminder(debtId) {
  const selectedDebt = debtId ? debt(debtId) : state.data.debts.find((d) => d.status !== "paid");
  openModal("Schedule Reminder", [
    { name: "customerId", label: "Customer", type: "select", options: customerOptions(), value: selectedDebt?.customerId, required: true },
    { name: "debtId", label: "Debt", type: "select", options: debtOptions(), value: selectedDebt?.id, required: true },
    { name: "channel", label: "Channel", type: "select", options: ["WhatsApp", "Email", "Phone"].map((x) => ({ value: x, label: x })), required: true },
    { name: "tone", label: "Tone", type: "select", options: ["Friendly", "Polite", "Firm"].map((x) => ({ value: x, label: x })), value: state.data.business.reminderTone },
    { name: "scheduledFor", label: "Scheduled For", type: "date", value: today(), required: true },
    { name: "message", label: "Message", type: "textarea", full: true, value: "Hi, this is a reminder about your outstanding payment.", required: true }
  ], (data) => api("/api/reminders", { method: "POST", body: data }));
}

function addEvent(seed = {}) {
  openModal("Add Calendar Event", [
    { name: "title", label: "Title", value: seed.title || "", required: true },
    { name: "customerId", label: "Customer", type: "select", options: [{ value: "", label: "None" }, ...customerOptions()], value: seed.customerId || "" },
    { name: "debtId", label: "Debt", type: "select", options: [{ value: "", label: "None" }, ...state.data.debts.map((d) => ({ value: d.id, label: `${customer(d.customerId).name} - ${d.description || "Debt"}` }))], value: seed.debtId || "" },
    { name: "date", label: "Date", type: "date", value: seed.date || today(), required: true },
    { name: "time", label: "Time", type: "time", value: seed.time || "09:00", required: true }
  ], (data) => api("/api/calendarEvents", { method: "POST", body: data }));
}

function addUpload() {
  openModal("Add Proof Upload", [
    { name: "name", label: "File name", required: true },
    { name: "type", label: "Type", type: "select", options: ["proof", "receipt", "agreement", "other"].map((x) => ({ value: x, label: x })) },
    { name: "customerId", label: "Customer", type: "select", options: customerOptions() },
    { name: "debtId", label: "Debt", type: "select", options: state.data.debts.map((d) => ({ value: d.id, label: `${customer(d.customerId).name} - ${d.description || "Debt"}` })) }
  ], (data) => api("/api/uploads", { method: "POST", body: data }));
}

async function deleteItem(collection, id, label) {
  if (!confirm(`Delete this ${label}?`)) return;
  state.data = await api(`/api/${collection}/${id}`, { method: "DELETE" });
  render();
  toast(`${label} deleted`);
}

async function connectIntegration(key) {
  const payload = {
    google: { email: "alex.morgan@gmail.com" },
    calendar: { calendarName: "DebtTrack Collections", email: state.data.user?.email || "alex.morgan@gmail.com" },
    whatsapp: { phone: "+1 555-0000" },
    email: { address: state.data.user?.email || "alex.morgan@gmail.com" }
  }[key];
  state.data = await api(`/api/integrations/${key}/connect`, { method: "POST", body: payload });
  render();
  toast(`${key} connected`);
}

async function persistBusinessSettings() {
  state.data = await api("/api/settings", {
    method: "PUT",
    body: {
      name: $("#businessName")?.value || state.data.business.name,
      currency: state.data.business.currency,
      baseCurrency: state.data.business.baseCurrency,
      reminderTone: $("#reminderTone")?.value || state.data.business.reminderTone,
      defaultReminderDays: Number($("#defaultReminderDays")?.value || state.data.business.defaultReminderDays || 3)
    }
  });
}

async function changeCurrency(currency) {
  state.data.business.currency = currency;
  render();
  try {
    await persistBusinessSettings();
    render();
    toast(`Currency changed to ${currency}`);
  } catch (error) {
    toast(`Currency changed locally, but could not save: ${error.message}`);
  }
}

async function handleAction(target) {
  const action = target.dataset.action;
  if (!action) return;
  if (action === "close-modal") return $("#modal").close();
  if (action === "open-create") return addDebt();
  if (action === "google-login") {
    if (window.google?.accounts?.id) {
      window.google.accounts.id.prompt();
      return;
    }
    return toast("Google Sign-In is still loading. Refresh if it does not appear.");
  }
  if (action === "logout") {
    await api("/api/auth/logout", { method: "POST", body: {} });
    state.session = { authenticated: false };
    state.data = null;
    toast("Logged out");
    return navigate("/login", true);
  }
  if (action === "forgot-password") {
    return toast("Password reset is not connected yet. Contact your workspace admin.");
  }
  if (action === "add-customer") return addCustomer();
  if (action === "edit-customer") return addCustomer(state.data.customers.find((c) => c.id === target.dataset.id));
  if (action === "delete-customer") return deleteItem("customers", target.dataset.id, "customer");
  if (action === "add-debt") return addDebt(target.dataset.customerId);
  if (action === "delete-debt") return deleteItem("debts", target.dataset.id, "debt");
  if (action === "record-payment") return recordPayment(target.dataset.debtId);
  if (action === "schedule-reminder") return scheduleReminder(target.dataset.debtId);
  if (action === "send-reminder") {
    state.data = await api("/api/reminders/send", { method: "POST", body: { id: target.dataset.id } });
    render();
    return toast("Reminder sent");
  }
  if (action === "delete-reminder") return deleteItem("reminders", target.dataset.id, "reminder");
  if (action === "calendar-from-reminder") {
    const r = state.data.reminders.find((item) => item.id === target.dataset.id);
    return addEvent({ title: `Follow-up: ${customer(r.customerId).name}`, customerId: r.customerId, debtId: r.debtId, date: r.scheduledFor, time: "09:00" });
  }
  if (action === "add-event") return addEvent();
  if (action === "delete-event") return deleteItem("calendarEvents", target.dataset.id, "event");
  if (action === "connect-calendar") return connectIntegration("calendar");
  if (action === "connect-integration") return connectIntegration(target.dataset.key);
  if (action === "disconnect-integration") {
    state.data = await api(`/api/integrations/${target.dataset.key}/disconnect`, { method: "POST", body: {} });
    render();
    return toast(`${target.dataset.key} disconnected`);
  }
  if (action === "save-settings") {
    state.data.business.name = $("#businessName").value;
    state.data.business.currency = $("#businessCurrency").value;
    state.data.business.reminderTone = $("#reminderTone").value;
    state.data.business.defaultReminderDays = Number($("#defaultReminderDays").value || 3);
    await persistBusinessSettings();
    render();
    return toast("Settings saved");
  }
  if (action === "add-upload") return addUpload();
  if (action === "export-customers") {
    window.location.href = "/api/export/customers.csv";
    return toast("CSV export started");
  }
}

document.addEventListener("click", async (event) => {
  const routeLink = event.target.closest("[data-route]");
  if (routeLink) {
    event.preventDefault();
    return navigate(routeLink.dataset.route);
  }
  const pageLink = event.target.closest("[data-page-link]");
  if (pageLink) return setPage(pageLink.dataset.pageLink);
  const nav = event.target.closest(".nav-item");
  if (nav) return setPage(nav.dataset.page);
  const action = event.target.closest("[data-action]");
  if (!action) return;
  try {
    await handleAction(action);
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "loginForm" && event.target.id !== "registerForm") return;
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target).entries());
  try {
    const endpoint = event.target.id === "loginForm" ? "/api/auth/login" : "/api/auth/register";
    state.session = await api(endpoint, { method: "POST", body });
    toast(event.target.id === "loginForm" ? "Logged in" : "Account created");
    await navigate("/dashboard", true);
  } catch (error) {
    toast(error.message);
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id !== "businessCurrency") return;
  try {
    await changeCurrency(event.target.value);
  } catch (error) {
    toast(error.message);
  }
});

window.addEventListener("popstate", () => {
  renderRoute(location.pathname).catch((error) => toast(error.message));
});

$("#globalSearch").addEventListener("input", (event) => {
  state.search = event.target.value;
  if (state.page !== "customers") setPage("customers");
  else renderCustomers();
});

load().catch((error) => toast(error.message));
