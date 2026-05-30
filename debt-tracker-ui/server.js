const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "319758693443-njiu6ngs5eb6j8uhh1oqv6m27oj1sqtj.apps.googleusercontent.com";

const now = () => new Date().toISOString();

function defaultBusiness() {
  return {
    name: "DebtTrack Pro",
    reminderTone: "Friendly",
    baseCurrency: "NGN",
    currency: "NGN",
    defaultReminderDays: 3
  };
}

function defaultIntegrations() {
  return {
    google: { connected: false, email: null, connectedAt: null },
    calendar: { connected: false, calendarName: null, connectedAt: null },
    whatsapp: { connected: false, phone: null, connectedAt: null },
    email: { connected: false, address: null, connectedAt: null }
  };
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function daysFromNow(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function seedState() {
  return {
    user: null,
    users: [],
    sessions: {},
    business: defaultBusiness(),
    integrations: defaultIntegrations(),
    customers: [
      { id: "cus_john", name: "John Doe", email: "john.doe@gmail.com", phone: "+1 555-0101", notes: "Prefers WhatsApp reminders.", createdAt: now() },
      { id: "cus_sarah", name: "Sarah Johnson", email: "sarah.j@outlook.com", phone: "+1 555-0142", notes: "Usually pays in two parts.", createdAt: now() },
      { id: "cus_michael", name: "Michael Brown", email: "m.brown@yahoo.com", phone: "+1 555-0198", notes: "", createdAt: now() },
      { id: "cus_emily", name: "Emily Davis", email: "emily.d@gmail.com", phone: "+1 555-0210", notes: "", createdAt: now() }
    ],
    debts: [
      { id: "debt_1", customerId: "cus_john", amount: 2500, paid: 0, dueDate: daysFromNow(-8), description: "Business supplies invoice", proof: "invoice-john.pdf", status: "overdue", createdAt: now() },
      { id: "debt_2", customerId: "cus_sarah", amount: 1200, paid: 600, dueDate: daysFromNow(4), description: "Service balance", proof: "signed-agreement.png", status: "partial", createdAt: now() },
      { id: "debt_3", customerId: "cus_michael", amount: 3800, paid: 0, dueDate: daysFromNow(8), description: "Bulk order", proof: "", status: "unpaid", createdAt: now() },
      { id: "debt_4", customerId: "cus_emily", amount: 950, paid: 0, dueDate: daysFromNow(12), description: "Monthly credit", proof: "", status: "unpaid", createdAt: now() }
    ],
    payments: [
      { id: "pay_1", customerId: "cus_sarah", debtId: "debt_2", amount: 600, method: "Cash", note: "First partial payment", receiptNo: "RCT-1001", paidAt: daysFromNow(-3), createdAt: now() }
    ],
    reminders: [
      { id: "rem_1", customerId: "cus_john", debtId: "debt_1", channel: "WhatsApp", tone: "Firm", scheduledFor: daysFromNow(0), status: "scheduled", message: "Hi John, your payment is overdue. Please let us know when you can settle it.", createdAt: now() },
      { id: "rem_2", customerId: "cus_sarah", debtId: "debt_2", channel: "WhatsApp", tone: "Friendly", scheduledFor: daysFromNow(2), status: "scheduled", message: "Hi Sarah, this is a friendly reminder about your upcoming balance.", createdAt: now() }
    ],
    calendarEvents: [
      { id: "evt_1", title: "Payment follow-up: John Doe", customerId: "cus_john", debtId: "debt_1", date: daysFromNow(0), time: "10:00", source: "local", createdAt: now() },
      { id: "evt_2", title: "Promise to pay: Sarah Johnson", customerId: "cus_sarah", debtId: "debt_2", date: daysFromNow(2), time: "12:30", source: "local", createdAt: now() }
    ],
    uploads: [
      { id: "upl_1", name: "invoice-john.pdf", customerId: "cus_john", debtId: "debt_1", type: "proof", uploadedAt: now() }
    ],
    auditLogs: [
      { id: "log_1", action: "Seed data created", detail: "Initial demo workspace generated.", createdAt: now() }
    ]
  };
}

function ensureDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(seedState(), null, 2));
  }
}

function readDb() {
  ensureDb();
  const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  db.users ||= [];
  db.sessions ||= {};
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function log(db, action, detail) {
  db.auditLogs.unshift({ id: `log_${randomUUID()}`, action, detail, createdAt: now() });
  db.auditLogs = db.auditLogs.slice(0, 120);
}

function logFor(db, user, action, detail) {
  db.auditLogs.unshift({ id: `log_${randomUUID()}`, ownerId: user.id, action, detail, createdAt: now() });
  db.auditLogs = db.auditLogs.slice(0, 400);
}

function customerName(db, id) {
  return db.customers.find((c) => c.id === id)?.name || "Unknown customer";
}

function recalcDebt(debt) {
  debt.amount = money(debt.amount);
  debt.paid = money(debt.paid);
  if (debt.paid >= debt.amount) debt.status = "paid";
  else if (debt.paid > 0) debt.status = "partial";
  else if (new Date(debt.dueDate) < new Date(new Date().toISOString().slice(0, 10))) debt.status = "overdue";
  else debt.status = "unpaid";
  return debt;
}

function metrics(db) {
  db.debts.forEach(recalcDebt);
  const totalDebt = db.debts.reduce((sum, d) => sum + d.amount, 0);
  const recovered = db.debts.reduce((sum, d) => sum + d.paid, 0);
  const outstanding = db.debts.reduce((sum, d) => sum + Math.max(d.amount - d.paid, 0), 0);
  const overdue = db.debts
    .filter((d) => d.status === "overdue")
    .reduce((sum, d) => sum + Math.max(d.amount - d.paid, 0), 0);
  const today = new Date().toISOString().slice(0, 10);
  const collectedToday = db.payments
    .filter((p) => p.paidAt === today)
    .reduce((sum, p) => sum + p.amount, 0);
  return {
    totalCustomers: db.customers.length,
    totalDebt: money(totalDebt),
    recovered: money(recovered),
    outstanding: money(outstanding),
    overdue: money(overdue),
    collectedToday: money(collectedToday),
    activeReminders: db.reminders.filter((r) => r.status === "scheduled").length,
    recoveryRate: totalDebt ? Math.round((recovered / totalDebt) * 100) : 0
  };
}

function withComputed(db) {
  db.debts.forEach(recalcDebt);
  const { users, sessions, ...publicDb } = db;
  return {
    ...publicDb,
    metrics: metrics(db),
    customerSummaries: db.customers.map((customer) => {
      const debts = db.debts.filter((d) => d.customerId === customer.id);
      const totalDebt = debts.reduce((sum, d) => sum + d.amount, 0);
      const paid = debts.reduce((sum, d) => sum + d.paid, 0);
      const balance = totalDebt - paid;
      const latestPayment = db.payments
        .filter((p) => p.customerId === customer.id)
        .sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
      const status = debts.some((d) => d.status === "overdue")
        ? "overdue"
        : balance === 0 && debts.length
          ? "paid"
          : paid > 0
            ? "partial"
            : "unpaid";
      return { ...customer, totalDebt: money(totalDebt), paid: money(paid), balance: money(balance), status, lastPayment: latestPayment?.paidAt || null };
    })
  };
}

function send(res, status, payload, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  send(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  send(res, 400, { error: message });
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(String(password)).digest("hex");
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function currentUser(req, db) {
  const sessionId = parseCookies(req).dt_session;
  const session = sessionId ? db.sessions[sessionId] : null;
  if (!session) return null;
  return db.users.find((user) => user.id === session.userId) || null;
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    googleId: user.googleId || null,
    name: user.name,
    email: user.email,
    picture: user.picture || null,
    provider: user.provider,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null
  };
}

function ensureAccountWorkspace(user) {
  user.business ||= defaultBusiness();
  user.business.baseCurrency ||= user.business.currency || "NGN";
  user.business.currency ||= user.business.baseCurrency;
  user.integrations ||= defaultIntegrations();
  return user;
}

function scopedDb(db, user) {
  ensureAccountWorkspace(user);
  const ownerId = user.id;
  const customerIds = new Set(db.customers.filter((item) => item.ownerId === ownerId).map((item) => item.id));
  const debtIds = new Set(db.debts.filter((item) => item.ownerId === ownerId).map((item) => item.id));
  return {
    user: {
      id: user.id,
      googleId: user.googleId || null,
      name: user.name,
      email: user.email,
      picture: user.picture || null,
      provider: user.provider,
      signedInAt: user.lastLoginAt || user.createdAt
    },
    business: user.business,
    integrations: user.integrations,
    customers: db.customers.filter((item) => item.ownerId === ownerId),
    debts: db.debts.filter((item) => item.ownerId === ownerId),
    payments: db.payments.filter((item) => item.ownerId === ownerId),
    reminders: db.reminders.filter((item) => item.ownerId === ownerId),
    calendarEvents: db.calendarEvents.filter((item) => item.ownerId === ownerId),
    uploads: db.uploads.filter((item) => item.ownerId === ownerId),
    auditLogs: db.auditLogs.filter((item) => item.ownerId === ownerId).slice(0, 120)
  };
}

function scopedResponse(db, user) {
  return withComputed(scopedDb(db, user));
}

function createSession(res, db, user) {
  ensureAccountWorkspace(user);
  const sessionId = randomUUID();
  db.sessions[sessionId] = { userId: user.id, createdAt: now() };
  db.user = {
    id: user.id,
    googleId: user.googleId || null,
    name: user.name,
    email: user.email,
    picture: user.picture || null,
    provider: user.provider,
    signedInAt: now()
  };
  res.setHeader("Set-Cookie", `dt_session=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
}

function clearSession(req, res, db) {
  const sessionId = parseCookies(req).dt_session;
  if (sessionId) delete db.sessions[sessionId];
  db.user = null;
  res.setHeader("Set-Cookie", "dt_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

function publicApiPath(pathname) {
  return [
    "/api/config",
    "/api/auth/session",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/google",
    "/api/auth/logout"
  ].includes(pathname);
}

async function verifyGoogleCredential(credential) {
  if (!credential) throw new Error("Missing Google credential");
  const tokenUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
  const response = await fetch(tokenUrl);
  if (!response.ok) throw new Error("Google token verification failed");
  const profile = await response.json();
  if (profile.aud !== GOOGLE_CLIENT_ID) throw new Error("Google token audience does not match this app");
  if (profile.email_verified !== "true" && profile.email_verified !== true) throw new Error("Google email is not verified");
  return profile;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === "") return field;
  }
  return null;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function serveStatic(req, res) {
  const requested = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname);
  const protectedPages = ["/dashboard", "/customers", "/debts", "/payments", "/reminders", "/calendar", "/reports", "/settings", "/logs"];
  if (protectedPages.includes(requested)) {
    const db = readDb();
    if (!currentUser(req, db)) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }
  }

  const appRoutes = ["/", "/login", "/register", ...protectedPages];
  const filePath = appRoutes.includes(requested) ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, requested);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(normalized, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(normalized);
    const type = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json" }[ext] || "text/plain";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const db = readDb();
  const body = ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) ? await parseBody(req) : {};
  const user = currentUser(req, db);

  if (req.method === "GET" && url.pathname === "/api/config") {
    return send(res, 200, { googleClientId: GOOGLE_CLIENT_ID });
  }

  if (req.method === "GET" && url.pathname === "/api/auth/session") {
    return send(res, 200, { authenticated: Boolean(user), user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/register") {
    const missing = requireFields(body, ["name", "email", "password"]);
    if (missing) return badRequest(res, `Missing required field: ${missing}`);
    const email = String(body.email).trim().toLowerCase();
    if (db.users.some((account) => account.email === email)) return badRequest(res, "An account with this email already exists");
    const account = {
      id: `user_${randomUUID()}`,
      name: String(body.name).trim(),
      email,
      passwordHash: hashPassword(body.password),
      provider: "password",
      business: defaultBusiness(),
      integrations: defaultIntegrations(),
      createdAt: now(),
      lastLoginAt: now()
    };
    db.users.push(account);
    createSession(res, db, account);
    logFor(db, account, "Account registered", `${email} created an account.`);
    writeDb(db);
    return send(res, 201, { authenticated: true, user: db.user });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const missing = requireFields(body, ["email", "password"]);
    if (missing) return badRequest(res, `Missing required field: ${missing}`);
    const email = String(body.email).trim().toLowerCase();
    const account = db.users.find((candidate) => candidate.email === email && candidate.passwordHash === hashPassword(body.password));
    if (!account) return badRequest(res, "Invalid email or password");
    account.lastLoginAt = now();
    createSession(res, db, account);
    logFor(db, account, "Password login", `${email} signed in.`);
    writeDb(db);
    return send(res, 200, { authenticated: true, user: db.user });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    clearSession(req, res, db);
    writeDb(db);
    return send(res, 200, { authenticated: false });
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    if (!user) return send(res, 401, { error: "Authentication required" });
    db.customers = db.customers.filter((item) => item.ownerId !== user.id);
    db.debts = db.debts.filter((item) => item.ownerId !== user.id);
    db.payments = db.payments.filter((item) => item.ownerId !== user.id);
    db.reminders = db.reminders.filter((item) => item.ownerId !== user.id);
    db.calendarEvents = db.calendarEvents.filter((item) => item.ownerId !== user.id);
    db.uploads = db.uploads.filter((item) => item.ownerId !== user.id);
    db.auditLogs = db.auditLogs.filter((item) => item.ownerId !== user.id);
    user.business = defaultBusiness();
    user.integrations = defaultIntegrations();
    logFor(db, user, "Workspace reset", "Tracking data was reset to zero.");
    writeDb(db);
    return send(res, 200, scopedResponse(db, user));
  }

  if (req.method === "POST" && url.pathname === "/api/auth/google") {
    const profile = await verifyGoogleCredential(body.credential);
    const email = String(profile.email).trim().toLowerCase();
    let account = db.users.find((candidate) => candidate.googleId === profile.sub || candidate.email === email);
    if (!account) {
      account = {
        id: `user_${randomUUID()}`,
        googleId: profile.sub,
        name: profile.name || email,
        email,
        picture: profile.picture || null,
        provider: "google",
        business: defaultBusiness(),
        integrations: defaultIntegrations(),
        createdAt: now()
      };
      db.users.push(account);
    }
    ensureAccountWorkspace(account);
    account.googleId = profile.sub;
    account.name = profile.name || account.name;
    account.picture = profile.picture || account.picture || null;
    account.provider = "google";
    account.lastLoginAt = now();
    createSession(res, db, account);
    account.integrations.google = { connected: true, email: db.user.email, connectedAt: now() };
    logFor(db, account, "Google login", `${email} signed in with Google.`);
    writeDb(db);
    return send(res, 200, { authenticated: true, user: db.user });
  }

  if (!publicApiPath(url.pathname) && !user) return send(res, 401, { error: "Authentication required" });

  if (req.method === "GET" && url.pathname === "/api/state") {
    return send(res, 200, scopedResponse(db, user));
  }

  if (req.method === "PUT" && url.pathname === "/api/settings") {
    ensureAccountWorkspace(user);
    user.business = { ...user.business, ...body };
    user.business.defaultReminderDays = Number(user.business.defaultReminderDays || 3);
    logFor(db, user, "Settings updated", "Business settings were saved.");
    writeDb(db);
    return send(res, 200, scopedResponse(db, user));
  }

  if (parts[0] === "api" && parts[1] === "integrations" && parts[2]) {
    const key = parts[2];
    ensureAccountWorkspace(user);
    if (!user.integrations[key]) return notFound(res);
    if (req.method === "POST" && parts[3] === "connect") {
      user.integrations[key] = { connected: true, connectedAt: now(), ...body };
      if (key === "calendar" && !user.integrations.google.connected) {
        user.integrations.google = { connected: true, email: body.email || user.email, connectedAt: now() };
      }
      logFor(db, user, "Integration connected", `${key} connected.`);
      writeDb(db);
      return send(res, 200, scopedResponse(db, user));
    }
    if (req.method === "POST" && parts[3] === "disconnect") {
      user.integrations[key] = { connected: false, connectedAt: null };
      logFor(db, user, "Integration disconnected", `${key} disconnected.`);
      writeDb(db);
      return send(res, 200, scopedResponse(db, user));
    }
  }

  if (parts[0] === "api" && ["customers", "debts", "payments", "reminders", "calendarEvents", "uploads"].includes(parts[1])) {
    const collection = parts[1];
    const id = parts[2];

    if (req.method === "POST" && !id) {
      const required = {
        customers: ["name", "phone"],
        debts: ["customerId", "amount", "dueDate"],
        payments: ["debtId", "amount", "method", "paidAt"],
        reminders: ["customerId", "debtId", "channel", "scheduledFor", "message"],
        calendarEvents: ["title", "date", "time"],
        uploads: ["name", "type"]
      }[collection];
      const missing = requireFields(body, required);
      if (missing) return badRequest(res, `Missing required field: ${missing}`);

      if (collection === "payments") {
        const debt = db.debts.find((d) => d.id === body.debtId && d.ownerId === user.id);
        if (!debt) return badRequest(res, "Debt not found");
        const amount = money(body.amount);
        if (amount <= 0) return badRequest(res, "Payment amount must be greater than zero");
        debt.paid = money(debt.paid + amount);
        recalcDebt(debt);
        const payment = {
          id: `pay_${randomUUID()}`,
          ownerId: user.id,
          customerId: debt.customerId,
          debtId: debt.id,
          amount,
          method: body.method,
          note: body.note || "",
          paidAt: body.paidAt,
          receiptNo: `RCT-${1000 + db.payments.length + 1}`,
          createdAt: now()
        };
        db.payments.unshift(payment);
        logFor(db, user, "Payment recorded", `${customerName(db, debt.customerId)} paid $${amount.toFixed(2)}.`);
        writeDb(db);
        return send(res, 201, scopedResponse(db, user));
      }

      const item = { id: `${collection.slice(0, 3)}_${randomUUID()}`, ownerId: user.id, ...body, createdAt: now() };
      if (item.customerId && !db.customers.some((customer) => customer.id === item.customerId && customer.ownerId === user.id)) {
        return badRequest(res, "Customer not found");
      }
      if (item.debtId && !db.debts.some((debt) => debt.id === item.debtId && debt.ownerId === user.id)) {
        return badRequest(res, "Debt not found");
      }
      if (collection === "debts") {
        item.amount = money(item.amount);
        item.paid = money(item.paid || 0);
        recalcDebt(item);
      }
      if (collection === "reminders") item.status = item.status || "scheduled";
      if (collection === "calendarEvents") item.source = item.source || "local";
      db[collection].unshift(item);
      logFor(db, user, `${collection} created`, item.name || item.title || item.description || item.message || item.id);
      writeDb(db);
      return send(res, 201, scopedResponse(db, user));
    }

    if (req.method === "PUT" && id) {
      const index = db[collection].findIndex((item) => item.id === id && item.ownerId === user.id);
      if (index < 0) return notFound(res);
      db[collection][index] = { ...db[collection][index], ...body, updatedAt: now() };
      if (collection === "debts") recalcDebt(db[collection][index]);
      logFor(db, user, `${collection} updated`, id);
      writeDb(db);
      return send(res, 200, scopedResponse(db, user));
    }

    if (req.method === "DELETE" && id) {
      const index = db[collection].findIndex((item) => item.id === id && item.ownerId === user.id);
      if (index < 0) return notFound(res);
      const [removed] = db[collection].splice(index, 1);
      if (collection === "customers") {
        db.debts = db.debts.filter((d) => d.ownerId !== user.id || d.customerId !== id);
        db.payments = db.payments.filter((p) => p.ownerId !== user.id || p.customerId !== id);
        db.reminders = db.reminders.filter((r) => r.ownerId !== user.id || r.customerId !== id);
      }
      logFor(db, user, `${collection} deleted`, removed.name || removed.title || id);
      writeDb(db);
      return send(res, 200, scopedResponse(db, user));
    }
  }

  if (req.method === "POST" && url.pathname === "/api/reminders/send") {
    const reminder = db.reminders.find((r) => r.id === body.id && r.ownerId === user.id);
    if (!reminder) return notFound(res);
    reminder.status = "sent";
    reminder.sentAt = now();
    logFor(db, user, "Reminder sent", `${reminder.channel} reminder sent to ${customerName(db, reminder.customerId)}.`);
    writeDb(db);
    return send(res, 200, scopedResponse(db, user));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/summary") {
    const scoped = scopedDb(db, user);
    return send(res, 200, {
      metrics: metrics(scoped),
      aging: {
        current: scoped.debts.filter((d) => d.status === "unpaid").length,
        partial: scoped.debts.filter((d) => d.status === "partial").length,
        overdue: scoped.debts.filter((d) => d.status === "overdue").length,
        paid: scoped.debts.filter((d) => d.status === "paid").length
      },
      generatedAt: now()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/export/customers.csv") {
    const rows = scopedResponse(db, user).customerSummaries.map((c) => [c.name, c.email, c.phone, c.totalDebt, c.paid, c.balance, c.status]);
    const csv = [["Name", "Email", "Phone", "Total Debt", "Paid", "Balance", "Status"], ...rows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n");
    res.writeHead(200, { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=customers.csv" });
    res.end(csv);
    return;
  }

  notFound(res);
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch((error) => {
      send(res, 500, { error: error.message || "Server error" });
    });
    return;
  }
  serveStatic(req, res);
});

ensureDb();
server.listen(PORT, () => {
  console.log(`DebtTrack Pro running at http://localhost:${PORT}`);
});
