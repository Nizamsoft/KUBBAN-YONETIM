// ============================================================================
//  GÜLLÜOĞLU KÜBBAN — SUPABASE BACKEND
//  local-backend.js ile BİREBİR aynı API — ama veri Supabase'te (Postgres).
//  Geçiş: app.js'teki import satırını
//     ... } from "./local-backend.js?v=..."
//  şununla değiştir:
//     ... } from "./supabase-backend.js?v=..."
//  Her koleksiyon bir tablo: kolonlar (id text pk, doc jsonb, created_at).
//  Kurulum SQL'i: supabase-setup.sql · Ayarlar: config.js (SUPABASE_URL / KEY)
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js?v=2026.117";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const genId = () =>
  (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));

// ---- Firestore-benzeri referanslar --------------------------------------
export function serverTimestamp() { return new Date().toISOString(); }
export function initializeApp(_config) { return { __sb: true }; }
export function getFirestore(_app) { return { __db: true }; }
export function collection(_db, name) { return { __type: "col", name }; }
export function doc(a, name, id) {
  if (a && a.__type === "col") return { __type: "doc", name: a.name, id: genId() };
  return { __type: "doc", name, id: id ?? genId() };
}
export function where(field, op, value) { return { __c: "where", field, op, value }; }
export function orderBy(field, dir = "asc") { return { __c: "orderBy", field, dir }; }
export function limit(n) { return { __c: "limit", n }; }
export function query(ref, ...constraints) { return { __type: "query", name: ref.name, constraints }; }

// Kısıtları JS'te uygula (local-backend ile birebir aynı davranış)
function applyConstraints(rows, constraints = []) {
  let out = rows.slice();
  for (const c of constraints) {
    if (c.__c === "where") {
      out = out.filter((r) => {
        const v = r[c.field];
        switch (c.op) {
          case "==": return v === c.value;
          case "!=": return v !== c.value;
          case ">":  return v > c.value;
          case ">=": return v >= c.value;
          case "<":  return v < c.value;
          case "<=": return v <= c.value;
          default:   return true;
        }
      });
    } else if (c.__c === "orderBy") {
      out.sort((a, b) => {
        const av = a[c.field], bv = b[c.field];
        const r = av > bv ? 1 : av < bv ? -1 : 0;
        return c.dir === "desc" ? -r : r;
      });
    } else if (c.__c === "limit") {
      out = out.slice(0, c.n);
    }
  }
  return out;
}

// Tüm satırları getir (Supabase 1000 satır sınırını sayfalayarak aşar)
async function fetchRows(name) {
  const out = []; const page = 1000; let from = 0;
  while (true) {
    const { data, error } = await sb.from(name).select("id,doc").range(from, from + page - 1);
    if (error) throw new Error(`${name}: ${error.message}`);
    (data || []).forEach((r) => out.push({ id: r.id, ...(r.doc || {}) }));
    if (!data || data.length < page) break;
    from += page;
  }
  return out;
}

// ---- Okuma / Yazma -------------------------------------------------------
export async function getDocs(refOrQuery) {
  const rows = applyConstraints(await fetchRows(refOrQuery.name), refOrQuery.constraints || []);
  return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r }) })) };
}

export async function getDoc(ref) {
  const { data, error } = await sb.from(ref.name).select("id,doc").eq("id", ref.id).maybeSingle();
  if (error) throw new Error(error.message);
  const found = data ? { id: data.id, ...(data.doc || {}) } : null;
  return { exists: () => !!found, id: ref.id, data: () => (found ? { ...found } : undefined) };
}

export async function addDoc(colRef, data) {
  const id = genId();
  const { error } = await sb.from(colRef.name).insert({ id, doc: data });
  if (error) throw new Error(error.message);
  return { id };
}

export async function setDoc(ref, data) {
  const { error } = await sb.from(ref.name).upsert({ id: ref.id, doc: data });
  if (error) throw new Error(error.message);
}

export async function updateDoc(ref, data) {
  // merge (Firestore update davranışı): mevcut doc'u çek, birleştir, yaz
  const { data: cur, error: e1 } = await sb.from(ref.name).select("doc").eq("id", ref.id).maybeSingle();
  if (e1) throw new Error(e1.message);
  const merged = { ...(cur?.doc || {}), ...data };
  const { error } = await sb.from(ref.name).upsert({ id: ref.id, doc: merged });
  if (error) throw new Error(error.message);
}

export async function deleteDoc(ref) {
  const { error } = await sb.from(ref.name).delete().eq("id", ref.id);
  if (error) throw new Error(error.message);
}

// Toplu yazma — set/update tablo başına tek upsert, delete tablo başına tek in()
export function writeBatch(_db) {
  const ops = [];
  return {
    set(ref, data) { ops.push({ type: "set", ref, data }); return this; },
    update(ref, data) { ops.push({ type: "update", ref, data }); return this; },
    delete(ref) { ops.push({ type: "del", ref }); return this; },
    async commit() {
      const upserts = {}, dels = {}, updates = [];
      for (const op of ops) {
        const n = op.ref.name;
        if (op.type === "del") (dels[n] = dels[n] || []).push(op.ref.id);
        else if (op.type === "set") (upserts[n] = upserts[n] || []).push({ id: op.ref.id, doc: op.data });
        else updates.push(op);
      }
      for (const [n, rows] of Object.entries(upserts)) {
        const { error } = await sb.from(n).upsert(rows);
        if (error) throw new Error(`${n}: ${error.message}`);
      }
      for (const [n, ids] of Object.entries(dels)) {
        const { error } = await sb.from(n).delete().in("id", ids);
        if (error) throw new Error(`${n}: ${error.message}`);
      }
      for (const op of updates) await updateDoc(op.ref, op.data);
    },
  };
}

// ---- Kimlik doğrulama (Supabase Auth) ------------------------------------
let _currentUser = null;
const mapUser = (u) => u ? { uid: u.id, email: u.email || "", displayName: u.user_metadata?.displayName || "" } : null;
function authErr(code) { const e = new Error(code); e.code = code; return e; }
function mapAuthError(err) {
  const m = (err?.message || "").toLowerCase();
  if (m.includes("invalid login")) return "auth/wrong-password";
  if (m.includes("already registered") || m.includes("already been registered")) return "auth/email-already-in-use";
  if (m.includes("password")) return "auth/weak-password";
  if (m.includes("email")) return "auth/invalid-email";
  return err?.message || "auth/error";
}

export function getAuth(_app) { return { __auth: true, get currentUser() { return _currentUser; } }; }

export function onAuthStateChanged(_auth, cb) {
  // supabase-js abone olunca mevcut oturumla hemen bir kez tetikler (INITIAL_SESSION)
  const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
    _currentUser = mapUser(session?.user);
    cb(_currentUser);
  });
  return () => sub?.subscription?.unsubscribe?.();
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email: (email || "").trim().toLowerCase(), password });
  if (error) throw authErr(mapAuthError(error));
  return { user: mapUser(data.user) };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  const { data, error } = await sb.auth.signUp({ email: (email || "").trim().toLowerCase(), password });
  if (error) throw authErr(mapAuthError(error));
  return { user: mapUser(data.user) };
}

export async function signOut(_auth) { await sb.auth.signOut(); }

export async function updateProfile(_user, { displayName }) {
  const { error } = await sb.auth.updateUser({ data: { displayName } });
  if (error) throw new Error(error.message);
}

// ---- Dosya yükleme (Storage: avatars) ------------------------------------
// file: Blob/File → 'avatars' kovasına {uid}.jpg olarak yükler, herkese açık URL döner
export async function uploadAvatar(file, uid) {
  const path = `${uid}.jpg`;
  const { error } = await sb.storage.from("avatars").upload(path, file, { upsert: true, contentType: "image/jpeg" });
  if (error) throw new Error(error.message);
  const { data } = sb.storage.from("avatars").getPublicUrl(path);
  return `${data.publicUrl}?t=${Date.now()}`;   // önbelleği kır — yeni foto hemen görünsün
}

// ---- Yönetici kullanıcı yönetimi (Edge Function) -------------------------
// action: "list" | "create" | "delete" | "setRole" | "setPassword"
// Not: fonksiyon Supabase'de "quick-task" adıyla deploy edildi (slug sabit).
const ADMIN_FN = "quick-task";
export async function adminUsers(action, payload = {}) {
  const { data, error } = await sb.functions.invoke(ADMIN_FN, { body: { action, ...payload } });
  if (error) {
    let msg = error.message || "Sunucu hatası";
    try { const c = await error.context?.json?.(); if (c?.error) msg = c.error; } catch (_) {}
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

// ---- Yedek / bakım -------------------------------------------------------
export const COLLECTIONS = [
  "users", "accounts", "accountEntries", "dayEndRecords",
  "currentMovements", "bankTransactions", "cashflowItems", "settings", "auditLog",
];

export async function exportAll() {
  const data = {};
  for (const n of COLLECTIONS) {
    try { data[n] = (await fetchRows(n)); } catch { data[n] = []; }
  }
  return { exportedAt: new Date().toISOString(), version: 1, source: "supabase", collections: data };
}

export async function importAll(payload, { replace = true } = {}) {
  const cols = payload?.collections || {};
  for (const n of COLLECTIONS) {
    const rows = cols[n];
    if (!rows || !rows.length) continue;
    if (replace) { await sb.from(n).delete().neq("id", "___none___"); }
    // {id, ...doc} → {id, doc}
    const recs = rows.map((r) => { const { id, ...rest } = r; return { id: id ?? genId(), doc: rest }; });
    for (let i = 0; i < recs.length; i += 500) {
      const { error } = await sb.from(n).upsert(recs.slice(i, i + 500));
      if (error) throw new Error(`${n}: ${error.message}`);
    }
  }
}

export async function storageStats() {
  const counts = {};
  for (const n of COLLECTIONS) {
    try {
      const { count } = await sb.from(n).select("id", { count: "exact", head: true });
      counts[n] = count || 0;
    } catch { counts[n] = 0; }
  }
  return { counts, bytes: 0 };
}

export async function clearAllData() {
  for (const n of COLLECTIONS) await sb.from(n).delete().neq("id", "___none___");
}
