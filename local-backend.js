// ============================================================================
//  YEREL BACKEND (Firebase yerine tarayıcı depolaması)
//  ---------------------------------------------------------------------------
//  Bu modül, Firebase Auth + Firestore SDK'sının kullandığımız fonksiyonlarını
//  AYNI isim ve imzalarla taklit eder; ancak tüm veriyi tarayıcının
//  localStorage'ında saklar. Böylece Firebase'i EN SONA bırakabiliriz.
//
//  Firebase'e geçince yapılacak TEK şey: app.js'in en üstündeki import
//  satırlarını tekrar "https://www.gstatic.com/firebasejs/..." adreslerine
//  çevirmek. Aşağıdaki fonksiyon imzaları birebir uyumludur.
//
//  ⚠️ Uyarı: Veriler yalnızca bu tarayıcıda saklanır. Parolalar düz metin
//     olarak tutulur (yalnızca yerel prototip içindir). Düzenli olarak
//     "Yedekle" ile dışa aktarın. Firebase bağlanınca gerçek güvenlik gelir.
// ============================================================================

const NS = "kubban:";
const AUTH_KEY = NS + "auth";        // [{uid,email,password,displayName}]
const SESSION_KEY = NS + "session";  // uid
const colKey = (name) => NS + "col:" + name;

const genId = () =>
  (crypto?.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)));

// ---- localStorage yardımcıları -------------------------------------------
function readArr(key) {
  try { return JSON.parse(localStorage.getItem(key) || "[]"); }
  catch { return []; }
}
function writeArr(key, arr) { localStorage.setItem(key, JSON.stringify(arr)); }

// serverTimestamp yerine ISO tarih (tarayıcıda çalışır)
export function serverTimestamp() { return new Date().toISOString(); }

// ===========================================================================
//  UYGULAMA / DB / KOLEKSİYON REFERANSLARI
// ===========================================================================
export function initializeApp(_config) { return { __local: true }; }
export function getFirestore(_app) { return { __db: true }; }

export function collection(_db, name) { return { __type: "col", name }; }

// doc(db, name, id)  |  doc(colRef)   → yeni id
export function doc(a, name, id) {
  if (a && a.__type === "col") return { __type: "doc", name: a.name, id: genId() };
  return { __type: "doc", name, id: id ?? genId() };
}

// Sorgu kısıtları
export function where(field, op, value) { return { __c: "where", field, op, value }; }
export function orderBy(field, dir = "asc") { return { __c: "orderBy", field, dir }; }
export function limit(n) { return { __c: "limit", n }; }
export function query(ref, ...constraints) {
  return { __type: "query", name: ref.name, constraints };
}

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

// ===========================================================================
//  OKUMA / YAZMA
// ===========================================================================
export async function getDocs(refOrQuery) {
  const name = refOrQuery.name;
  const rows = applyConstraints(readArr(colKey(name)), refOrQuery.constraints || []);
  return { docs: rows.map((r) => ({ id: r.id, data: () => ({ ...r }) })) };
}

export async function getDoc(ref) {
  const rows = readArr(colKey(ref.name));
  const found = rows.find((r) => r.id === ref.id);
  return { exists: () => !!found, id: ref.id, data: () => (found ? { ...found } : undefined) };
}

export async function addDoc(colRef, data) {
  const id = genId();
  const rows = readArr(colKey(colRef.name));
  rows.push({ id, ...data });
  writeArr(colKey(colRef.name), rows);
  return { id };
}

export async function setDoc(ref, data) {
  const key = colKey(ref.name);
  const rows = readArr(key);
  const i = rows.findIndex((r) => r.id === ref.id);
  const rec = { id: ref.id, ...data };
  if (i >= 0) rows[i] = rec; else rows.push(rec);
  writeArr(key, rows);
}

export async function updateDoc(ref, data) {
  const key = colKey(ref.name);
  const rows = readArr(key);
  const i = rows.findIndex((r) => r.id === ref.id);
  if (i >= 0) { rows[i] = { ...rows[i], ...data }; writeArr(key, rows); }
}

export async function deleteDoc(ref) {
  const key = colKey(ref.name);
  writeArr(key, readArr(key).filter((r) => r.id !== ref.id));
}

// Toplu yazma (Firestore writeBatch taklidi)
export function writeBatch(_db) {
  const ops = [];
  return {
    set(ref, data) { ops.push({ ref, data }); return this; },
    update(ref, data) { ops.push({ ref, data, merge: true }); return this; },
    delete(ref) { ops.push({ ref, del: true }); return this; },
    async commit() {
      for (const op of ops) {
        const key = colKey(op.ref.name);
        const rows = readArr(key);
        if (op.del) { writeArr(key, rows.filter((r) => r.id !== op.ref.id)); continue; }
        const i = rows.findIndex((r) => r.id === op.ref.id);
        if (i >= 0) rows[i] = op.merge ? { ...rows[i], ...op.data } : { id: op.ref.id, ...op.data };
        else rows.push({ id: op.ref.id, ...op.data });
        writeArr(key, rows);
      }
    },
  };
}

// ===========================================================================
//  KİMLİK DOĞRULAMA (Firebase Auth taklidi)
// ===========================================================================
const _authListeners = [];
let _currentUser = null;

function loadSession() {
  const uid = localStorage.getItem(SESSION_KEY);
  if (!uid) return null;
  const u = readArr(AUTH_KEY).find((x) => x.uid === uid);
  return u ? { uid: u.uid, email: u.email, displayName: u.displayName || "" } : null;
}
function notify() { _authListeners.forEach((cb) => cb(_currentUser)); }
function authErr(code) { const e = new Error(code); e.code = code; return e; }

export function getAuth(_app) {
  _currentUser = loadSession();
  return { __auth: true, get currentUser() { return _currentUser; } };
}

export function onAuthStateChanged(_auth, cb) {
  _authListeners.push(cb);
  queueMicrotask(() => cb(_currentUser));       // Firebase gibi async ilk çağrı
  return () => { const i = _authListeners.indexOf(cb); if (i >= 0) _authListeners.splice(i, 1); };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  email = (email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) throw authErr("auth/invalid-email");
  if ((password || "").length < 6) throw authErr("auth/weak-password");
  const users = readArr(AUTH_KEY);
  if (users.some((u) => u.email === email)) throw authErr("auth/email-already-in-use");
  const user = { uid: genId(), email, password, displayName: "" };
  users.push(user);
  writeArr(AUTH_KEY, users);
  localStorage.setItem(SESSION_KEY, user.uid);
  _currentUser = { uid: user.uid, email: user.email, displayName: "" };
  notify();
  return { user: _currentUser };
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  email = (email || "").trim().toLowerCase();
  const user = readArr(AUTH_KEY).find((u) => u.email === email);
  if (!user) throw authErr("auth/user-not-found");
  if (user.password !== password) throw authErr("auth/invalid-credential");
  localStorage.setItem(SESSION_KEY, user.uid);
  _currentUser = { uid: user.uid, email: user.email, displayName: user.displayName || "" };
  notify();
  return { user: _currentUser };
}

export async function signOut(_auth) {
  localStorage.removeItem(SESSION_KEY);
  _currentUser = null;
  notify();
}

export async function updateProfile(user, { displayName }) {
  const users = readArr(AUTH_KEY);
  const i = users.findIndex((u) => u.uid === (user.uid || _currentUser?.uid));
  if (i >= 0) { users[i].displayName = displayName; writeArr(AUTH_KEY, users); }
  if (_currentUser) _currentUser = { ..._currentUser, displayName };
}

// ===========================================================================
//  YEDEK / GERİ YÜKLE  (yerel moda özel yardımcılar)
// ===========================================================================
export const COLLECTIONS = [
  "users", "accounts", "accountEntries", "dayEndRecords",
  "currentMovements", "bankTransactions", "cashflowItems", "auditLog",
];

export function exportAll() {
  const data = {};
  COLLECTIONS.forEach((n) => { data[n] = readArr(colKey(n)); });
  return { exportedAt: new Date().toISOString(), version: 1, collections: data };
}

export function importAll(payload, { replace = true } = {}) {
  const cols = payload?.collections || {};
  COLLECTIONS.forEach((n) => {
    if (!cols[n]) return;
    if (replace) writeArr(colKey(n), cols[n]);
    else writeArr(colKey(n), readArr(colKey(n)).concat(cols[n]));
  });
}

export function storageStats() {
  const stats = {};
  let total = 0;
  COLLECTIONS.forEach((n) => {
    const rows = readArr(colKey(n));
    stats[n] = rows.length;
  });
  Object.keys(localStorage).filter((k) => k.startsWith(NS)).forEach((k) => {
    total += (localStorage.getItem(k) || "").length;
  });
  return { counts: stats, bytes: total };
}

export function clearAllData() {
  Object.keys(localStorage).filter((k) => k.startsWith(colKey(""))).forEach((k) => localStorage.removeItem(k));
}
