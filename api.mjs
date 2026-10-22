// Storage and sign-in for the Home Budget Planner, kept in Netlify Blobs.
// Records: "data" (entries, categories, rate), "users" (family accounts), "secret" (session signing key).
// BUDGET_PASSCODE is only needed once, to create the first (admin) account.
import { getStore } from "@netlify/blobs";
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

// The two entries carried over from the original spreadsheet; used only when the store is empty.
const SEED = {
  txns: [
    { id: "sheet-1", date: "2026-08-05", cat: "home-expense-fund", catName: "Home Expense Fund", type: "income", amount: 100000, cur: "INR", method: "Cash", note: "Through Chhaya", by: "Sanjeev", created: 1787850538000 },
    { id: "sheet-2", date: "2026-01-01", cat: "loan-taken", catName: "Loan Taken", type: "loan", dir: "in", amount: 200000, cur: "INR", method: "Cash", note: "From Kalpana", by: "Sanjeev", created: 1787850878000 },
  ],
};
const SESSION_DAYS = 60;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (error, status = 400) => json({ error }, status);

const hash = (password, salt) => scryptSync(password, salt, 32).toString("hex");
const checkPassword = (u, password) =>
  typeof password === "string" && timingSafeEqual(Buffer.from(hash(password, u.salt), "hex"), Buffer.from(u.hash, "hex"));
const setPassword = (u, password) => { u.salt = randomBytes(16).toString("hex"); u.hash = hash(password, u.salt); u.tv = (u.tv || 0) + 1; };
const cleanName = (s) => (typeof s === "string" ? s.trim().slice(0, 40) : "");
const cleanUsername = (s) => (typeof s === "string" ? s.trim().toLowerCase() : "");
const validUsername = (s) => /^[a-z0-9._-]{2,30}$/.test(s);
const validPassword = (s) => typeof s === "string" && s.length >= 6 && s.length <= 200;
const publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, active: u.active !== false });

const isTxn = (b) =>
  b && typeof b === "object" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) && typeof b.cat === "string" &&
  Number.isFinite(b.amount) && b.amount > 0 && (b.cur === "INR" || b.cur === "USD");

async function secret(store) {
  let s = await store.get("secret");
  if (!s) { s = randomBytes(32).toString("hex"); await store.set("secret", s); }
  return s;
}
async function issueToken(store, u) {
  const payload = Buffer.from(JSON.stringify({ id: u.id, tv: u.tv, exp: Date.now() + SESSION_DAYS * 864e5 })).toString("base64url");
  const sig = createHmac("sha256", await secret(store)).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}
async function readToken(store, token, users) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  const want = createHmac("sha256", await secret(store)).update(payload).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  let p; try { p = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return null; }
  const u = users.find((x) => x.id === p.id);
  // Password changes and removals bump or end access immediately.
  if (!u || u.active === false || u.tv !== p.tv || p.exp < Date.now()) return null;
  return u;
}

export default async (req) => {
  if (req.method !== "POST") return fail("Method not allowed", 405);
  let body; try { body = await req.json(); } catch { return fail("Invalid JSON"); }
  const store = getStore("home-budget");
  const users = ((await store.get("users", { type: "json" })) || { users: [] }).users;
  const saveUsers = () => store.setJSON("users", { users });
  const loadData = async () => (await store.get("data", { type: "json" })) || structuredClone(SEED);
  const a = body.action;

  // --- no sign-in needed ---
  if (a === "status") return json({ needsSetup: users.length === 0 });

  if (a === "setup") {
    if (users.length) return fail("This planner is already set up. Sign in instead.", 409);
    const code = process.env.BUDGET_PASSCODE;
    if (!code) return fail("Set BUDGET_PASSCODE in Netlify before creating the first account.", 500);
    if (body.code !== code) return fail("That setup passcode is wrong.", 401);
    const name = cleanName(body.name), username = cleanUsername(body.username);
    if (!name || !validUsername(username)) return fail("Enter a name and a username of 2–30 letters, numbers, dots or dashes.");
    if (!validPassword(body.password)) return fail("Use a password of at least 6 characters.");
    const u = { id: "u" + randomBytes(6).toString("hex"), name, username, role: "admin", active: true, created: Date.now() };
    setPassword(u, body.password); users.push(u); await saveUsers();
    return json({ token: await issueToken(store, u), me: publicUser(u) });
  }

  if (a === "login") {
    const u = users.find((x) => x.username === cleanUsername(body.username) && x.active !== false);
    if (!u || !checkPassword(u, body.password)) {
      await new Promise((r) => setTimeout(r, 600));
      return fail("Username or password is wrong.", 401);
    }
    return json({ token: await issueToken(store, u), me: publicUser(u) });
  }

  // --- signed in ---
  const me = await readToken(store, (req.headers.get("authorization") || "").replace(/^Bearer /, ""), users);
  if (!me) return fail("Please sign in again.", 401);
  const isAdmin = me.role === "admin";
  const everything = async (data) => json({ ...(data || (await loadData())), me: publicUser(me), users: users.map(publicUser) });

  if (a === "data") return everything();

  if (a === "putTxn" || a === "delTxn") {
    const data = await loadData(); data.txns ||= [];
    const i = data.txns.findIndex((t) => t.id === body.id);
    const old = i >= 0 ? data.txns[i] : null;
    // Family members change only their own entries; admins can change any.
    if (old && !isAdmin && old.byId !== me.id) return fail("You can only change entries you added.", 403);
    if (a === "delTxn") {
      if (i >= 0) data.txns.splice(i, 1);
    } else {
      if (typeof body.id !== "string" || body.id.length > 64 || !isTxn(body.body)) return fail("That entry is incomplete.");
      const { by, byId, editedBy, editedById, editedAt, ...fields } = body.body;
      const entry = old
        ? { ...fields, id: body.id, by: old.by, byId: old.byId, created: old.created, editedBy: me.name, editedById: me.id, editedAt: Date.now() }
        : { ...fields, id: body.id, by: me.name, byId: me.id, created: Date.now() };
      if (i >= 0) data.txns[i] = entry; else data.txns.push(entry);
    }
    await store.setJSON("data", data);
    return everything(data);
  }

  if (a === "config") {
    if (!isAdmin) return fail("Only an admin can change budgets and categories.", 403);
    if (!Array.isArray(body.cats) || !body.cats.length || !(Number(body.rate) > 0)) return fail("Invalid settings.");
    const data = await loadData(); data.cats = body.cats; data.rate = Number(body.rate);
    await store.setJSON("data", data);
    return everything(data);
  }

  if (a === "changePassword") {
    if (!checkPassword(me, body.old)) return fail("Your current password is wrong.", 403);
    if (!validPassword(body.password)) return fail("Use a password of at least 6 characters.");
    setPassword(me, body.password); await saveUsers();
    return json({ token: await issueToken(store, me), me: publicUser(me) });
  }

  if (a === "addUser") {
    if (!isAdmin) return fail("Only an admin can add family members.", 403);
    const name = cleanName(body.name), username = cleanUsername(body.username);
    if (!name || !validUsername(username)) return fail("Enter a name and a username of 2–30 letters, numbers, dots or dashes.");
    if (users.some((x) => x.username === username)) return fail("That username is taken.");
    if (!validPassword(body.password)) return fail("Use a password of at least 6 characters.");
    const u = { id: "u" + randomBytes(6).toString("hex"), name, username, role: body.role === "admin" ? "admin" : "member", active: true, created: Date.now() };
    setPassword(u, body.password); users.push(u); await saveUsers();
    return everything();
  }

  if (a === "updateUser") {
    if (!isAdmin) return fail("Only an admin can manage family members.", 403);
    const u = users.find((x) => x.id === body.id);
    if (!u) return fail("That person wasn't found.", 404);
    if (u.id === me.id && (body.role === "member" || body.active === false)) return fail("You can't remove your own admin access.");
    if (body.name !== undefined) { const n = cleanName(body.name); if (n) u.name = n; }
    if (body.role === "admin" || body.role === "member") u.role = body.role;
    if (body.password !== undefined) { if (!validPassword(body.password)) return fail("Use a password of at least 6 characters."); setPassword(u, body.password); }
    if (body.active === false) { u.active = false; u.tv = (u.tv || 0) + 1; }
    if (body.active === true) u.active = true;
    await saveUsers();
    return everything();
  }

  return fail("Unrecognised request.");
};

export const config = { path: "/api" };
