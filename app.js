// ============================================================================
//  GÜLLÜOĞLU KÜBBAN — YÖNETİM YAZILIMI  ·  app.js
//  Saf vanilla JS (framework yok) · Firebase Auth + Firestore
// ============================================================================

// ⚙️ YEREL MOD: Şimdilik tüm veri tarayıcıda (localStorage) saklanır.
// Firebase'e geçmek için aşağıdaki import'u tekrar gstatic Firebase SDK'sına
// çevirmek yeterli (fonksiyon imzaları birebir aynıdır). Bkz. local-backend.js
import {
  initializeApp, getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, writeBatch,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  exportAll, importAll, storageStats, clearAllData, COLLECTIONS,
} from "./local-backend.js";

import { COMPANY, BOOTSTRAP_ADMINS } from "./config.js";

// ---------------------------------------------------------------------------
//  Kısayollar & yardımcılar
// ---------------------------------------------------------------------------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const CONFIG_READY = true; // Yerel mod her zaman hazır

const nf  = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtTRY = (n) => (isFinite(n) ? nf.format(n) : "0,00") + " ₺";
const fmtNum = (n) => (isFinite(n) ? nf.format(n) : "0,00");
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtDate(iso) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? iso : new Date(iso).toISOString().slice(0, 10);
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}.${m}.${y}`;
}
function parseNum(v) {
  if (typeof v === "number") return v;
  if (v == null || v === "") return 0;
  let s = String(v).replace(/[^\d,.\-]/g, "").trim();
  // Türkçe format: 1.234,56  → 1234.56
  if (s.includes(",") && s.includes(".")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
//  Toast & Modal
// ---------------------------------------------------------------------------
function toast(msg, type = "") {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 3400);
}
function openModal({ title, body, footer, onClose }) {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head"><h3>${esc(title)}</h3></div>
        <div class="modal-body"></div>
        <div class="modal-foot"></div>
      </div>
    </div>`;
  const bodyEl = $(".modal-body", root);
  const footEl = $(".modal-foot", root);
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  (footer || []).forEach((b) => footEl.appendChild(b));
  const close = () => { root.innerHTML = ""; onClose && onClose(); };
  $(".modal-backdrop", root).addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("modal-backdrop")) close();
  });
  return { close, bodyEl, footEl };
}
function mkBtn(label, cls, onClick) {
  const b = document.createElement("button");
  b.className = "btn " + (cls || "");
  b.textContent = label;
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
function confirmDialog(message, onYes) {
  const m = openModal({
    title: "Onay",
    body: `<p style="margin:0">${esc(message)}</p>`,
    footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Evet, devam et", "btn-danger", () => { m.close(); onYes(); }),
    ],
  });
}

// ---------------------------------------------------------------------------
//  Firebase başlat
// ---------------------------------------------------------------------------
let app, auth, db;
if (CONFIG_READY) {
  app  = initializeApp({});   // yerel mod
  auth = getAuth(app);
  db   = getFirestore(app);
}

// Firestore koleksiyon kısayolları (bkz. DATA-MODEL.md)
const C = {
  users:            () => collection(db, "users"),
  accounts:         () => collection(db, "accounts"),
  dayEndRecords:    () => collection(db, "dayEndRecords"),
  currentMovements: () => collection(db, "currentMovements"),
  bankTransactions: () => collection(db, "bankTransactions"),
  cashflowItems:    () => collection(db, "cashflowItems"),
};

// ---------------------------------------------------------------------------
//  Durum
// ---------------------------------------------------------------------------
let currentUser = null;      // { uid, email, displayName, role }
const isAdmin = () => currentUser && currentUser.role === "admin";

// ---------------------------------------------------------------------------
//  KİMLİK DOĞRULAMA (AUTH)
// ---------------------------------------------------------------------------
let signupMode = false;
function setupAuthUI() {
  const form = $("#login-form");
  const errEl = $("#auth-error");
  const nameField = $("#name-field");
  const submit = $("#auth-submit");
  const toggleText = $("#toggle-text");
  const toggle = $("#toggle-mode");

  if (!CONFIG_READY) {
    errEl.innerHTML =
      "⚠️ <b>Firebase yapılandırması eksik.</b><br>Lütfen <code>config.js</code> " +
      "dosyasına kendi Firebase proje bilgilerinizi girin.";
    submit.disabled = true;
  }

  toggle.addEventListener("click", () => {
    signupMode = !signupMode;
    nameField.classList.toggle("hidden", !signupMode);
    submit.textContent = signupMode ? "Kayıt Ol" : "Giriş Yap";
    toggleText.textContent = signupMode ? "Zaten hesabınız var mı?" : "Hesabınız yok mu?";
    toggle.textContent = signupMode ? "Giriş yapın" : "Kayıt olun";
    errEl.textContent = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errEl.textContent = "";
    submit.disabled = true;
    const email = $("#email").value.trim();
    const pass  = $("#password").value;
    try {
      if (signupMode) {
        const name = $("#displayName").value.trim();
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        if (name) await updateProfile(cred.user, { displayName: name });
        await ensureUserDoc(cred.user, name);
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch (err) {
      errEl.textContent = authErrorTR(err.code || err.message);
      submit.disabled = false;
    }
  });
}
function authErrorTR(code) {
  const map = {
    "auth/invalid-email": "Geçersiz e-posta adresi.",
    "auth/user-not-found": "Kullanıcı bulunamadı.",
    "auth/wrong-password": "Hatalı parola.",
    "auth/invalid-credential": "E-posta veya parola hatalı.",
    "auth/email-already-in-use": "Bu e-posta zaten kayıtlı.",
    "auth/weak-password": "Parola en az 6 karakter olmalı.",
    "auth/too-many-requests": "Çok fazla deneme. Lütfen sonra tekrar deneyin.",
  };
  return map[code] || ("Bir hata oluştu: " + code);
}

// users/{uid} dokümanını oluştur/getir. İlk giriş yapan ya da BOOTSTRAP_ADMINS
// listesindeki e-postalar "admin" rolü ile başlar.
async function ensureUserDoc(fbUser, nameHint) {
  const ref = doc(db, "users", fbUser.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();
  const isBootstrapAdmin = BOOTSTRAP_ADMINS
    .map((e) => e.toLowerCase())
    .includes((fbUser.email || "").toLowerCase());
  const data = {
    email: fbUser.email || "",
    displayName: nameHint || fbUser.displayName || (fbUser.email || "").split("@")[0],
    role: isBootstrapAdmin ? "admin" : "user",
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data);
  return data;
}

function onAuth() {
  onAuthStateChanged(auth, async (fbUser) => {
    if (fbUser) {
      let profile;
      try { profile = await ensureUserDoc(fbUser); }
      catch { profile = { role: "user", displayName: fbUser.email, email: fbUser.email }; }
      currentUser = { uid: fbUser.uid, email: fbUser.email, ...profile };
      showApp();
    } else {
      currentUser = null;
      showLogin();
    }
  });
}

// ---------------------------------------------------------------------------
//  GÖRÜNÜM GEÇİŞLERİ
// ---------------------------------------------------------------------------
function showLoader(on) { $("#loader").classList.toggle("hidden", !on); }
function showLogin() {
  showLoader(false);
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}
function showApp() {
  showLoader(false);
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  // Kullanıcı bilgisi
  $("#user-name").textContent = currentUser.displayName || currentUser.email;
  $("#user-avatar").textContent = (currentUser.displayName || currentUser.email || "?")
    .trim().charAt(0).toUpperCase();
  const roleEl = $("#user-role");
  roleEl.textContent = isAdmin() ? "Yönetici" : "Kullanıcı";
  roleEl.classList.toggle("user", !isAdmin());
  buildNav();
  if (!location.hash) location.hash = "#/dashboard";
  route();
}
$("#user-chip").addEventListener("click", () => {
  confirmDialog("Oturumu kapatmak istiyor musunuz?", () => signOut(auth));
});

// ---------------------------------------------------------------------------
//  NAVİGASYON & YÖNLENDİRME (ROUTER)
// ---------------------------------------------------------------------------
// Akordeon menü: ana bölümler + alt sayfalar. Sıra kullanıcı isteğine göre.
const NAV = [
  { label: "Dashboard", icon: "📊", path: "dashboard" },
  { label: "Veri Girişleri", icon: "📝", children: [
    { label: "Cari Hareket İşleme", icon: "🔁", path: "cari-hareket" },
    { label: "Banka İşleme",        icon: "🏦", path: "banka" },
  ]},
  { label: "Gün Sonu İşlemleri", icon: "🌙", children: [
    { label: "Aktarım Ekranı",      icon: "📥", path: "gunsonu-aktarim" },
    { label: "Gün Sonu Kayıtları",  icon: "🗂️", path: "gunsonu-kayitlar" },
    { label: "Gün Sonu Raporu",     icon: "📄", path: "gunsonu-rapor" },
  ]},
  { label: "Hesaplar", icon: "💼", path: "hesaplar" },
  { label: "Raporlar", icon: "📈", children: [
    { label: "Nakit Akış Raporu",   icon: "📈", path: "nakit-akis-rapor" },
    { label: "Nakit Akış Verileri", icon: "🔄", path: "nakit-akis-veri" },
  ]},
  { label: "Sistem", icon: "⚙️", children: [
    { label: "Yedek / Veri", icon: "💾", path: "yedek" },
  ]},
];

const ROUTES = {
  "dashboard":        { title: "Dashboard", crumb: "Ana Sayfa", render: viewDashboard },
  "gunsonu-aktarim":  { title: "Aktarım Ekranı", crumb: "Gün Sonu", render: viewGunSonuAktarim },
  "gunsonu-kayitlar": { title: "Gün Sonu Kayıtları", crumb: "Gün Sonu", render: viewGunSonuKayitlar },
  "gunsonu-rapor":    { title: "Gün Sonu Raporu", crumb: "Gün Sonu", render: viewGunSonuRapor },
  "hesaplar":         { title: "Hesaplar", crumb: "Hesaplar", render: viewHesaplar },
  "cari-hareket":     { title: "Cari Hareket İşleme", crumb: "Veri Girişi", render: viewCariHareket },
  "banka":            { title: "Banka İşleme", crumb: "Veri Girişi", render: viewBanka },
  "nakit-akis-rapor": { title: "Nakit Akış Raporu", crumb: "Raporlar", render: viewNakitAkisRapor },
  "nakit-akis-veri":  { title: "Nakit Akış Verileri", crumb: "Raporlar", render: viewNakitAkisVeri },
  "yedek":            { title: "Yedek / Veri", crumb: "Sistem", render: viewYedek },
};

function buildNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  NAV.forEach((n) => {
    if (n.children) {
      // Akordeon grubu
      const group = document.createElement("div");
      group.className = "nav-group";
      group._paths = n.children.map((c) => c.path);

      const header = document.createElement("button");
      header.className = "nav-group-header";
      header.type = "button";
      header.innerHTML =
        `<span class="ico">${n.icon}</span><span class="lbl">${esc(n.label)}</span><span class="chev">▸</span>`;
      header.addEventListener("click", () => toggleGroup(group));

      const bodyEl = document.createElement("div");
      bodyEl.className = "nav-group-body";
      n.children.forEach((ch) => {
        const a = document.createElement("a");
        a.className = "nav-item nav-sub";
        a.href = "#/" + ch.path;
        a.dataset.path = ch.path;
        a.innerHTML = `<span class="ico">${ch.icon}</span><span>${esc(ch.label)}</span>`;
        bodyEl.appendChild(a);
      });

      group.appendChild(header);
      group.appendChild(bodyEl);
      nav.appendChild(group);
    } else {
      // Ana seviye tek bağlantı (Dashboard, Hesaplar)
      const a = document.createElement("a");
      a.className = "nav-item nav-top";
      a.href = "#/" + n.path;
      a.dataset.path = n.path;
      a.innerHTML = `<span class="ico">${n.icon}</span><span>${esc(n.label)}</span>`;
      nav.appendChild(a);
    }
  });
}
// Tek-açık akordeon: bir grup açılınca diğerleri kapanır
function toggleGroup(group) {
  const willOpen = !group.classList.contains("open");
  $$("#nav .nav-group").forEach((g) => g.classList.remove("open"));
  if (willOpen) group.classList.add("open");
}

async function route() {
  const path = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
  const r = ROUTES[path] || ROUTES["dashboard"];
  $$("#nav .nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.path === path));
  // Aktif sayfanın bulunduğu grubu aç (akordeon)
  $$("#nav .nav-group").forEach((g) =>
    g.classList.toggle("open", Array.isArray(g._paths) && g._paths.includes(path)));
  $("#page-title").textContent = r.title;
  $("#crumb").textContent = r.crumb;
  const c = $("#view-container");
  c.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;
  try {
    await r.render(c);
  } catch (err) {
    console.error(err);
    c.innerHTML = `<div class="notice warn"><b>Hata:</b> ${esc(err.message || err)}</div>`;
  }
}
window.addEventListener("hashchange", route);

// ---------------------------------------------------------------------------
//  FIRESTORE OKUMA YARDIMCILARI
// ---------------------------------------------------------------------------
async function fetchAll(colFn, ...constraints) {
  const q = constraints.length ? query(colFn(), ...constraints) : colFn();
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

// ---------------------------------------------------------------------------
//  EXCEL (SheetJS) — talep üzerine yüklenir
// ---------------------------------------------------------------------------
let _xlsx = null;
async function loadXLSX() {
  if (_xlsx) return _xlsx;
  _xlsx = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
  return _xlsx;
}
async function parseSpreadsheet(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false });
  // İlk boş olmayan satırı başlık kabul et
  let headerIdx = aoa.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if (headerIdx < 0) return { headers: [], rows: [] };
  const headers = aoa[headerIdx].map((h, i) => String(h).trim() || `Sütun ${i + 1}`);
  const rows = aoa.slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => headers.reduce((o, h, i) => ((o[h] = r[i] ?? ""), o), {}));
  return { headers, rows };
}

// Sütun adından anlam çıkar (esnek eşleme)
function guessCol(headers, keywords) {
  const low = headers.map((h) => h.toLocaleLowerCase("tr"));
  for (const k of keywords) {
    const i = low.findIndex((h) => h.includes(k));
    if (i >= 0) return headers[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
//  ORTAK: Dosya bırakma alanı
// ---------------------------------------------------------------------------
function fileDrop(onFile, accept = ".xlsx,.xls,.csv") {
  const wrap = document.createElement("div");
  wrap.className = "filedrop";
  wrap.innerHTML = `
    <div class="ico">📄</div>
    <div><b>Dosya seçin</b> ya da buraya sürükleyin</div>
    <div style="font-size:12px;color:var(--ink-faint);margin-top:4px">Excel (.xlsx/.xls) veya .csv</div>
    <input type="file" accept="${accept}" style="display:none" />`;
  const input = $("input", wrap);
  wrap.addEventListener("click", () => input.click());
  input.addEventListener("change", () => input.files[0] && onFile(input.files[0]));
  ["dragover", "dragenter"].forEach((ev) =>
    wrap.addEventListener(ev, (e) => { e.preventDefault(); wrap.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) =>
    wrap.addEventListener(ev, (e) => { e.preventDefault(); wrap.classList.remove("drag"); }));
  wrap.addEventListener("drop", (e) => e.dataTransfer.files[0] && onFile(e.dataTransfer.files[0]));
  return wrap;
}

// ---------------------------------------------------------------------------
//  ORTAK: Düzenlenebilir tablo
//  columns: [{key,label,type:'text'|'num'|'date'|'select',options?,readonly?}]
//  Geriye { getData, addRow, root } döner.
// ---------------------------------------------------------------------------
function editableTable(columns, initialRows = [], opts = {}) {
  const root = document.createElement("div");
  root.className = "table-wrap";
  const table = document.createElement("table");
  table.className = "data";
  const thead = `<thead><tr>${columns.map((c) =>
    `<th class="${c.type === "num" ? "num" : ""}">${esc(c.label)}</th>`).join("")}${
    opts.deletable === false ? "" : "<th></th>"}</tr></thead>`;
  table.innerHTML = thead + "<tbody></tbody>";
  const tbody = $("tbody", table);
  root.appendChild(table);

  function addRow(data = {}) {
    const tr = document.createElement("tr");
    columns.forEach((c) => {
      const td = document.createElement("td");
      if (c.type === "num") td.className = "num";
      if (c.readonly) {
        td.textContent = data[c.key] ?? "";
        td.dataset.key = c.key;
      } else if (c.type === "select") {
        const sel = document.createElement("select");
        (c.options || []).forEach((o) => {
          const opt = document.createElement("option");
          opt.value = typeof o === "string" ? o : o.value;
          opt.textContent = typeof o === "string" ? o : o.label;
          sel.appendChild(opt);
        });
        sel.value = data[c.key] ?? (c.options?.[0]?.value ?? c.options?.[0] ?? "");
        sel.dataset.key = c.key;
        td.appendChild(sel);
      } else {
        const inp = document.createElement("input");
        inp.type = c.type === "date" ? "date" : "text";
        if (c.type === "num") inp.classList.add("num");
        inp.value = c.type === "num"
          ? (data[c.key] !== "" && data[c.key] != null ? parseNum(data[c.key]) : "")
          : (data[c.key] ?? "");
        inp.dataset.key = c.key;
        inp.dataset.type = c.type || "text";
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    if (opts.deletable !== false) {
      const td = document.createElement("td");
      const del = document.createElement("button");
      del.className = "row-del"; del.textContent = "✕"; del.title = "Satırı sil";
      del.addEventListener("click", () => tr.remove());
      td.appendChild(del);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    return tr;
  }
  initialRows.forEach(addRow);

  function getData() {
    return $$("tbody tr", table).map((tr) => {
      const o = {};
      $$("[data-key]", tr).forEach((el) => {
        const k = el.dataset.key;
        const t = el.dataset.type;
        let v = el.tagName === "TD" ? el.textContent : el.value;
        o[k] = t === "num" ? parseNum(v) : v;
      });
      return o;
    });
  }
  return { root, getData, addRow, tbody };
}

// ===========================================================================
//  MODÜL: DASHBOARD
// ===========================================================================
async function viewDashboard(c) {
  const [accounts, records, cashflow, cari, bank] = await Promise.all([
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.dayEndRecords).catch(() => []),
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
  ]);
  const bal = computeBalances(accounts, cari, bank);
  const sumType = (t) => accounts.filter((a) => a.type === t)
    .reduce((s, a) => s + (bal.get(a.id)?.current || 0), 0);
  const kasa = sumType("kasa");
  const tedarikci = sumType("tedarikci");
  const banka = sumType("banka");

  const monthlyIn = cashflow.filter((x) => x.type === "gelir" && x.active !== false)
    .reduce((s, x) => s + monthlyEquivalent(x), 0);
  const monthlyOut = cashflow.filter((x) => x.type === "gider" && x.active !== false)
    .reduce((s, x) => s + monthlyEquivalent(x), 0);

  const recent = [...records].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);
  const todayRec = records.find((r) => r.date === todayISO());

  c.innerHTML = `
    <div class="grid cols-4">
      <div class="stat"><div class="label">Toplam Kasa (100)</div><div class="value">${fmtTRY(kasa)}</div><div class="foot">${accounts.filter(a=>a.type==="kasa").length} kasa hesabı</div></div>
      <div class="stat green"><div class="label">Banka</div><div class="value">${fmtTRY(banka)}</div><div class="foot">${accounts.filter(a=>a.type==="banka").length} banka hesabı</div></div>
      <div class="stat red"><div class="label">Tedarikçi Borcu (320)</div><div class="value">${fmtTRY(tedarikci)}</div><div class="foot">${accounts.filter(a=>a.type==="tedarikci").length} tedarikçi</div></div>
      <div class="stat"><div class="label">Aylık Net Nakit Akış</div><div class="value" style="color:${monthlyIn-monthlyOut>=0?'var(--ok)':'var(--danger)'}">${fmtTRY(monthlyIn-monthlyOut)}</div><div class="foot">Gelir ${fmtTRY(monthlyIn)} · Gider ${fmtTRY(monthlyOut)}</div></div>
    </div>

    <div class="grid cols-2" style="margin-top:18px">
      <div class="card">
        <div class="card-head"><h3>Bugünün Gün Sonu</h3><span class="hint">${fmtDate(todayISO())}</span></div>
        ${todayRec
          ? `<div class="stat" style="border-left-color:var(--ok)"><div class="label">Toplam Ciro</div><div class="value">${fmtTRY(todayRec.total||0)}</div><div class="foot">${(todayRec.rows||[]).length} satır · ${esc(todayRec.status||"")}</div></div>`
          : `<div class="empty"><div class="ico">🗓️</div><p>Bugün için gün sonu kaydı yok.</p><a class="btn btn-primary btn-sm" href="#/gunsonu-aktarim">Aktarım Ekranına Git</a></div>`}
      </div>
      <div class="card">
        <div class="card-head"><h3>Son Gün Sonu Kayıtları</h3><a class="hint" href="#/gunsonu-kayitlar">Tümü →</a></div>
        ${recent.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Tarih</th><th class="num">Toplam</th><th>Durum</th></tr></thead>
          <tbody>${recent.map((r) => `<tr>
            <td>${fmtDate(r.date)}</td>
            <td class="num">${fmtTRY(r.total || 0)}</td>
            <td><span class="tag ${r.status==="onaylandi"?"ok":"gold"}">${esc(r.status || "aktarıldı")}</span></td>
          </tr>`).join("")}</tbody></table></div>`
          : `<div class="empty"><div class="ico">🗂️</div><p>Henüz kayıt yok.</p></div>`}
      </div>
    </div>

    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Hızlı İşlemler</h3></div>
      <div class="toolbar" style="margin:0">
        <a class="btn" href="#/gunsonu-aktarim">📥 Gün Sonu Aktar</a>
        <a class="btn" href="#/cari-hareket">🔁 Cari Hareket Yükle</a>
        <a class="btn" href="#/banka">🏦 Banka Dosyası Yükle</a>
        <a class="btn" href="#/nakit-akis-rapor">📈 Nakit Akış Raporu</a>
        <a class="btn" href="#/hesaplar">💼 Hesaplar</a>
      </div>
    </div>`;
}
function monthlyEquivalent(item) {
  const amt = item.amount || 0;
  switch (item.period) {
    case "haftalik": return amt * 4.33;
    case "aylik":    return amt;
    case "3aylik":   return amt / 3;
    case "6aylik":   return amt / 6;
    case "yillik":   return amt / 12;
    default:         return amt;
  }
}

// ===========================================================================
//  MODÜL: GÜN SONU — AKTARIM EKRANI
//  Satış programından indirilen Excel'i içe aktar, düzenle, kayıt olarak gönder.
// ===========================================================================
let gsStaging = null; // { date, rows, headers }
async function viewGunSonuAktarim(c) {
  c.innerHTML = `
    <div class="notice info">📥 Satış programından indirdiğiniz <b>Excel</b> dosyasını yükleyin.
      Satırlar aşağıda düzenlenebilir tablo olarak açılır; kontrol edip <b>Gün Sonu Kaydı</b> olarak aktarın.</div>
    <div class="card" id="gs-drop-card">
      <div class="card-head"><h3>1) Dosya Yükle</h3></div>
      <div id="gs-drop"></div>
    </div>
    <div id="gs-editor"></div>`;

  $("#gs-drop").appendChild(fileDrop(async (file) => {
    try {
      const { headers, rows } = await parseSpreadsheet(file);
      if (!rows.length) return toast("Dosyada veri bulunamadı.", "err");
      gsStaging = { headers, rows, date: todayISO() };
      renderGsEditor(headers, rows);
      toast(`${rows.length} satır okundu.`, "ok");
    } catch (e) { toast("Dosya okunamadı: " + e.message, "err"); }
  }));

  function renderGsEditor(headers, rows) {
    const columns = headers.map((h) => ({
      key: h, label: h,
      type: /tutar|ciro|toplam|fiyat|adet|miktar|kdv|nakit|kredi|kart/i.test(h) ? "num" : "text",
    }));
    const et = editableTable(columns, rows);
    const editor = $("#gs-editor");
    editor.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>2) Kontrol & Düzenle</h3><span class="hint">${rows.length} satır</span></div>
        <div class="toolbar">
          <div class="field" style="margin:0">
            <label>Gün Sonu Tarihi</label>
            <input type="date" id="gs-date" value="${todayISO()}" />
          </div>
          <div class="field" style="margin:0">
            <label>Toplanacak Tutar Sütunu</label>
            <select id="gs-total-col">
              <option value="">(otomatik)</option>
              ${headers.map((h) => `<option value="${esc(h)}">${esc(h)}</option>`).join("")}
            </select>
          </div>
          <div class="grow"></div>
          <button class="btn btn-sm" id="gs-add">+ Satır Ekle</button>
        </div>
      </div>`;
    const tableCard = document.createElement("div");
    tableCard.className = "card";
    tableCard.appendChild(et.root);
    const foot = document.createElement("div");
    foot.className = "toolbar";
    foot.style.marginTop = "14px";
    const totalLbl = document.createElement("div");
    totalLbl.className = "grow";
    totalLbl.style.fontWeight = "700";
    foot.appendChild(totalLbl);
    const saveBtn = mkBtn("✔ Gün Sonu Kaydı Olarak Aktar", "btn-primary");
    foot.appendChild(saveBtn);
    tableCard.appendChild(foot);
    editor.appendChild(tableCard);

    const totalColGuess = guessCol(headers, ["toplam", "ciro", "tutar", "genel"]);
    if (totalColGuess) $("#gs-total-col").value = totalColGuess;

    function computeTotal() {
      const col = $("#gs-total-col").value ||
        guessCol(headers, ["toplam", "ciro", "tutar", "genel"]) ||
        headers.find((h) => /tutar|ciro|toplam/i.test(h));
      const data = et.getData();
      const total = col ? data.reduce((s, r) => s + parseNum(r[col]), 0) : 0;
      totalLbl.textContent = "Toplam: " + fmtTRY(total);
      return { total, data, col };
    }
    computeTotal();
    editor.addEventListener("input", computeTotal);
    $("#gs-add").addEventListener("click", () => { et.addRow(); computeTotal(); });

    saveBtn.addEventListener("click", async () => {
      const { total, data } = computeTotal();
      const date = $("#gs-date").value || todayISO();
      saveBtn.disabled = true;
      try {
        const existing = await fetchAll(C.dayEndRecords, where("date", "==", date));
        const payload = {
          date, rows: data, total, headers,
          totalColumn: $("#gs-total-col").value || totalColGuess || "",
          status: "aktarildi",
          rowCount: data.length,
          updatedAt: serverTimestamp(),
          updatedBy: currentUser.email,
        };
        if (existing.length) {
          await updateDoc(doc(db, "dayEndRecords", existing[0].id), payload);
          toast("Bu tarihe ait kayıt güncellendi.", "ok");
        } else {
          await addDoc(C.dayEndRecords(), {
            ...payload, notes: [], createdAt: serverTimestamp(), createdBy: currentUser.email,
          });
          toast("Gün sonu kaydı oluşturuldu.", "ok");
        }
        gsStaging = null;
        location.hash = "#/gunsonu-kayitlar";
      } catch (e) {
        toast("Kaydedilemedi: " + e.message, "err");
        saveBtn.disabled = false;
      }
    });
  }
}

// ===========================================================================
//  MODÜL: GÜN SONU — KAYITLAR (arşiv, yalnızca yetkili düzenler)
// ===========================================================================
async function viewGunSonuKayitlar(c) {
  const records = (await fetchAll(C.dayEndRecords))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  c.innerHTML = `
    ${isAdmin() ? "" : `<div class="notice info">🔒 Kayıtları yalnızca <b>yetkili (yönetici)</b> düzenleyebilir. Görüntüleme yetkiniz var.</div>`}
    <div class="card">
      <div class="card-head"><h3>Gün Sonu Arşivi</h3><span class="hint">${records.length} kayıt</span></div>
      ${records.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Tarih</th><th class="num">Toplam</th><th class="num">Satır</th><th>Durum</th><th>Oluşturan</th><th></th></tr></thead>
        <tbody>${records.map((r) => `<tr>
          <td><b>${fmtDate(r.date)}</b></td>
          <td class="num">${fmtTRY(r.total || 0)}</td>
          <td class="num">${r.rowCount ?? (r.rows || []).length}</td>
          <td><span class="tag ${r.status==="onaylandi"?"ok":"gold"}">${esc(r.status || "aktarıldı")}</span></td>
          <td>${esc(r.createdBy || "—")}</td>
          <td style="text-align:right">
            <button class="btn btn-sm" data-view="${r.id}">İncele</button>
            ${isAdmin() ? `<button class="btn btn-sm" data-edit="${r.id}">Düzenle</button>
              <button class="btn btn-sm btn-danger" data-del="${r.id}">Sil</button>` : ""}
          </td>
        </tr>`).join("")}</tbody></table></div>`
        : `<div class="empty"><div class="ico">🗂️</div><p>Henüz gün sonu kaydı yok.</p><a class="btn btn-primary btn-sm" href="#/gunsonu-aktarim">Aktarım Ekranı</a></div>`}
    </div>`;

  const byId = (id) => records.find((r) => r.id === id);
  $$("[data-view]", c).forEach((b) => b.onclick = () => openRecordModal(byId(b.dataset.view), false));
  $$("[data-edit]", c).forEach((b) => b.onclick = () => openRecordModal(byId(b.dataset.edit), true));
  $$("[data-del]", c).forEach((b) => b.onclick = () =>
    confirmDialog(`${fmtDate(byId(b.dataset.del).date)} tarihli kayıt silinsin mi?`, async () => {
      await deleteDoc(doc(db, "dayEndRecords", b.dataset.del));
      toast("Kayıt silindi.", "ok"); route();
    }));
}

function openRecordModal(rec, editMode) {
  const headers = rec.headers || (rec.rows?.[0] ? Object.keys(rec.rows[0]) : []);
  const columns = headers.map((h) => ({
    key: h, label: h, readonly: !editMode,
    type: /tutar|ciro|toplam|fiyat|adet|miktar|kdv|nakit|kart/i.test(h) ? "num" : "text",
  }));
  const et = editableTable(columns, rec.rows || [], { deletable: editMode });
  const body = document.createElement("div");
  body.innerHTML = `<div style="margin-bottom:12px">
    <b>${fmtDate(rec.date)}</b> · Toplam <b>${fmtTRY(rec.total || 0)}</b>
    <span class="tag ${rec.status==="onaylandi"?"ok":"gold"}" style="margin-left:6px">${esc(rec.status||"aktarıldı")}</span>
  </div>`;
  body.appendChild(et.root);

  const footer = [mkBtn("Kapat", "", () => m.close())];
  if (editMode) {
    footer.push(mkBtn(rec.status === "onaylandi" ? "Onayı Kaldır" : "Onayla", "", async () => {
      await updateDoc(doc(db, "dayEndRecords", rec.id), {
        status: rec.status === "onaylandi" ? "aktarildi" : "onaylandi",
        updatedAt: serverTimestamp(), updatedBy: currentUser.email,
      });
      m.close(); toast("Durum güncellendi.", "ok"); route();
    }));
    footer.push(mkBtn("💾 Değişiklikleri Kaydet", "btn-primary", async () => {
      const data = et.getData();
      const total = rec.totalColumn ? data.reduce((s, r) => s + parseNum(r[rec.totalColumn]), 0) : rec.total;
      await updateDoc(doc(db, "dayEndRecords", rec.id), {
        rows: data, total, rowCount: data.length,
        updatedAt: serverTimestamp(), updatedBy: currentUser.email,
      });
      m.close(); toast("Kayıt güncellendi.", "ok"); route();
    }));
  }
  const m = openModal({ title: "Gün Sonu Kaydı — " + fmtDate(rec.date), body, footer });
  $(".modal", $("#modal-root")).style.maxWidth = "820px";
}

// ===========================================================================
//  MODÜL: GÜN SONU — RAPOR (incele + not bırak)
// ===========================================================================
async function viewGunSonuRapor(c) {
  const records = (await fetchAll(C.dayEndRecords))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>Gün Sonu Raporu</h3><span class="hint">İlgili günü seçin, inceleyin ve not bırakın</span></div>
      <div class="toolbar" style="margin:0">
        <div class="field" style="margin:0;min-width:220px">
          <label>Gün Seçin</label>
          <select id="rep-date">
            <option value="">— seçin —</option>
            ${records.map((r) => `<option value="${r.id}">${fmtDate(r.date)} · ${fmtTRY(r.total||0)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
    <div id="rep-body"></div>`;

  $("#rep-date").addEventListener("change", (e) => {
    const rec = records.find((r) => r.id === e.target.value);
    renderReport(rec);
  });
  if (records[0]) { $("#rep-date").value = records[0].id; renderReport(records[0]); }

  function renderReport(rec) {
    const body = $("#rep-body");
    if (!rec) { body.innerHTML = ""; return; }
    const notes = rec.notes || [];
    const totalCol = rec.totalColumn;
    const nakit = sumCol(rec.rows, ["nakit"]);
    const kart  = sumCol(rec.rows, ["kart", "kredi"]);
    body.innerHTML = `
      <div class="grid cols-3">
        <div class="stat"><div class="label">Toplam Ciro</div><div class="value">${fmtTRY(rec.total||0)}</div></div>
        <div class="stat green"><div class="label">Nakit</div><div class="value">${fmtTRY(nakit)}</div></div>
        <div class="stat"><div class="label">Kart / Kredi</div><div class="value">${fmtTRY(kart)}</div></div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-head"><h3>Detay</h3><span class="hint">${(rec.rows||[]).length} satır</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr>${(rec.headers||[]).map((h)=>`<th class="${/tutar|ciro|toplam|nakit|kart/i.test(h)?'num':''}">${esc(h)}</th>`).join("")}</tr></thead>
          <tbody>${(rec.rows||[]).slice(0,200).map((row)=>`<tr>${(rec.headers||[]).map((h)=>{
            const isNum=/tutar|ciro|toplam|nakit|kart|fiyat|adet/i.test(h);
            return `<td class="${isNum?'num':''}">${isNum?fmtNum(parseNum(row[h])):esc(row[h])}</td>`;
          }).join("")}</tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-head"><h3>Notlar</h3></div>
        <div class="note-list" id="note-list">
          ${notes.length ? notes.map((n)=>`<div class="note"><div class="meta">${esc(n.by||"")} · ${esc(n.at||"")}</div>${esc(n.text)}</div>`).join("")
            : `<div class="empty" style="padding:20px"><p>Henüz not eklenmemiş.</p></div>`}
        </div>
        <div class="field" style="margin-top:14px">
          <label>Yeni Not</label>
          <textarea id="note-text" rows="2" placeholder="Bu gün sonu için notunuz..."></textarea>
        </div>
        <button class="btn btn-primary btn-sm" id="note-add">Not Ekle</button>
      </div>`;

    $("#note-add").addEventListener("click", async () => {
      const text = $("#note-text").value.trim();
      if (!text) return;
      const note = { text, by: currentUser.displayName || currentUser.email, at: new Date().toLocaleString("tr-TR") };
      const newNotes = [...notes, note];
      await updateDoc(doc(db, "dayEndRecords", rec.id), { notes: newNotes });
      rec.notes = newNotes;
      toast("Not eklendi.", "ok");
      renderReport(rec);
    });
  }
}
function sumCol(rows, keywords) {
  if (!rows || !rows.length) return 0;
  const headers = Object.keys(rows[0]);
  const col = guessCol(headers, keywords);
  return col ? rows.reduce((s, r) => s + parseNum(r[col]), 0) : 0;
}

// ===========================================================================
//  MODÜL: HESAPLAR (100 kasa, 320 tedarikçiler ...)
// ===========================================================================
const ACCOUNT_TYPES = [
  { value: "kasa", label: "Kasa (100)" },
  { value: "banka", label: "Banka (102)" },
  { value: "tedarikci", label: "Tedarikçi (320)" },
  { value: "musteri", label: "Müşteri / Cari (120)" },
  { value: "gider", label: "Gider" },
  { value: "diger", label: "Diğer" },
];
const accTypeLabel = (v) => (ACCOUNT_TYPES.find((t) => t.value === v)?.label || v || "—");

// Hesap bakiyelerini hareketlerden OTOMATİK hesapla:
//   güncel = açılış bakiyesi + cari hareket deltası + banka hareket deltası
//   · cari hareketler hesap KODUNA göre eşlenir (borç − alacak)
//   · banka hareketleri, Banka İşleme'de seçilen hedef hesabın id'sine göre eşlenir
function computeBalances(accounts, cari = [], bank = []) {
  const map = new Map();
  const byCode = new Map();
  accounts.forEach((a) => {
    const opening = a.openingBalance != null ? a.openingBalance : (a.balance || 0);
    map.set(a.id, { opening, delta: 0, current: opening });
    if (a.code) byCode.set(String(a.code).trim(), a.id);
  });
  cari.forEach((m) => {
    const id = byCode.get(String(m.code || "").trim());
    if (id) map.get(id).delta += parseNum(m.debit) - parseNum(m.credit);
  });
  bank.forEach((t) => {
    if (t.accountId && map.has(t.accountId)) map.get(t.accountId).delta += parseNum(t.amount);
  });
  map.forEach((e) => { e.current = e.opening + e.delta; });
  return map;
}

async function viewHesaplar(c) {
  const [accounts0, cari, bank] = await Promise.all([
    fetchAll(C.accounts),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
  ]);
  const accounts = accounts0.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
  const balances = computeBalances(accounts, cari, bank);
  let filter = "all";

  c.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="acc-filter">
        <button data-f="all" class="active">Tümü</button>
        <button data-f="kasa">Kasa</button>
        <button data-f="banka">Banka</button>
        <button data-f="tedarikci">Tedarikçi</button>
        <button data-f="musteri">Cari</button>
      </div>
      <div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="acc-add">+ Yeni Hesap</button>
    </div>
    <div id="acc-list"></div>`;

  function draw() {
    const list = filter === "all" ? accounts : accounts.filter((a) => a.type === filter);
    const total = list.reduce((s, a) => s + (balances.get(a.id)?.current || 0), 0);
    $("#acc-list").innerHTML = `
      <div class="notice info" style="margin-bottom:16px">ℹ️ Güncel bakiye = <b>açılış bakiyesi + hareketler</b>.
        Cari hareketler hesap koduna, banka hareketleri Banka İşleme'de seçilen hedef hesaba göre otomatik eklenir.</div>
      <div class="card">
        <div class="card-head"><h3>Hesaplar</h3><span class="hint">${list.length} hesap · Güncel Toplam ${fmtTRY(total)}</span></div>
        ${list.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Kod</th><th>Hesap Adı</th><th>Tür</th><th class="num">Açılış</th><th class="num">Hareket</th><th class="num">Güncel Bakiye</th><th></th></tr></thead>
          <tbody>${list.map((a) => { const b = balances.get(a.id) || { opening: 0, delta: 0, current: 0 }; return `<tr>
            <td><b>${esc(a.code || "—")}</b></td>
            <td>${esc(a.name || "")}</td>
            <td><span class="tag gold">${esc(accTypeLabel(a.type))}</span></td>
            <td class="num">${fmtTRY(b.opening)}</td>
            <td class="num" style="color:${b.delta<0?'var(--danger)':b.delta>0?'var(--ok)':'var(--ink-faint)'}">${b.delta>=0?"+":""}${fmtNum(b.delta)}</td>
            <td class="num" style="font-weight:700;color:${b.current<0?'var(--danger)':'inherit'}">${fmtTRY(b.current)}</td>
            <td style="text-align:right">
              <button class="btn btn-sm" data-edit="${a.id}">Düzenle</button>
              <button class="btn btn-sm btn-danger" data-del="${a.id}">Sil</button>
            </td></tr>`; }).join("")}</tbody>
        </table></div>`
          : `<div class="empty"><div class="ico">💼</div><p>Bu türde hesap yok.</p></div>`}
      </div>`;
    $$("[data-edit]", c).forEach((b) => b.onclick = () => accModal(accounts.find((a) => a.id === b.dataset.edit)));
    $$("[data-del]", c).forEach((b) => b.onclick = () =>
      confirmDialog("Hesap silinsin mi?", async () => {
        await deleteDoc(doc(db, "accounts", b.dataset.del));
        toast("Silindi.", "ok"); route();
      }));
  }
  $$("#acc-filter button", c).forEach((b) => b.onclick = () => {
    $$("#acc-filter button", c).forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); filter = b.dataset.f; draw();
  });
  $("#acc-add").onclick = () => accModal(null);
  draw();
}

function accModal(acc) {
  const isNew = !acc;
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="form-row">
      <div class="field"><label>Hesap Kodu</label><input id="a-code" value="${esc(acc?.code || "")}" placeholder="100.01" /></div>
      <div class="field"><label>Tür</label><select id="a-type">
        ${ACCOUNT_TYPES.map((t) => `<option value="${t.value}" ${acc?.type===t.value?"selected":""}>${t.label}</option>`).join("")}
      </select></div>
    </div>
    <div class="field"><label>Hesap Adı</label><input id="a-name" value="${esc(acc?.name || "")}" placeholder="Merkez Kasa" /></div>
    <div class="field"><label>Açılış Bakiyesi (₺)</label><input id="a-balance" class="num" value="${acc?.openingBalance ?? acc?.balance ?? 0}" />
      <div style="font-size:11px;color:var(--ink-faint);margin-top:4px">Güncel bakiye, bu değere hareketler eklenerek otomatik hesaplanır.</div></div>`;
  const m = openModal({
    title: isNew ? "Yeni Hesap" : "Hesabı Düzenle",
    body,
    footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Kaydet", "btn-primary", async () => {
        const payload = {
          code: $("#a-code", body).value.trim(),
          name: $("#a-name", body).value.trim(),
          type: $("#a-type", body).value,
          openingBalance: parseNum($("#a-balance", body).value),
          updatedAt: serverTimestamp(),
        };
        if (!payload.name) return toast("Hesap adı gerekli.", "err");
        try {
          if (isNew) await addDoc(C.accounts(), { ...payload, createdAt: serverTimestamp() });
          else await updateDoc(doc(db, "accounts", acc.id), payload);
          m.close(); toast("Kaydedildi.", "ok"); route();
        } catch (e) { toast("Hata: " + e.message, "err"); }
      }),
    ],
  });
}

// ===========================================================================
//  MODÜL: CARİ HAREKET İŞLEME (Uyumsoft Excel)
// ===========================================================================
async function viewCariHareket(c) {
  c.innerHTML = `
    <div class="notice info">🔁 <b>Uyumsoft</b>'tan indirdiğiniz cari hareket Excel raporunu yükleyin.
      Hareketler alt alta listelenir; düzenleyip <b>Kayıtları Gönder</b> ile kaydedin.</div>
    <div class="card"><div class="card-head"><h3>1) Excel Yükle</h3></div><div id="ch-drop"></div></div>
    <div id="ch-editor"></div>`;

  $("#ch-drop").appendChild(fileDrop(async (file) => {
    try {
      const { headers, rows } = await parseSpreadsheet(file);
      if (!rows.length) return toast("Veri bulunamadı.", "err");
      renderEditor(headers, rows);
      toast(`${rows.length} hareket okundu.`, "ok");
    } catch (e) { toast("Okunamadı: " + e.message, "err"); }
  }));

  function renderEditor(headers, rows) {
    // Uyumsoft sütunlarını esnek eşle
    const map = {
      date: guessCol(headers, ["tarih"]),
      code: guessCol(headers, ["cari kod", "hesap kod", "kod"]),
      name: guessCol(headers, ["cari", "unvan", "ünvan", "açıklama", "aciklama"]),
      debit: guessCol(headers, ["borç", "borc"]),
      credit: guessCol(headers, ["alacak"]),
    };
    const norm = rows.map((r) => ({
      date: excelDateToISO(r[map.date]),
      code: r[map.code] || "",
      name: r[map.name] || "",
      debit: parseNum(r[map.debit]),
      credit: parseNum(r[map.credit]),
    }));
    const columns = [
      { key: "date", label: "Tarih", type: "date" },
      { key: "code", label: "Cari Kod", type: "text" },
      { key: "name", label: "Cari / Açıklama", type: "text" },
      { key: "debit", label: "Borç", type: "num" },
      { key: "credit", label: "Alacak", type: "num" },
    ];
    const et = editableTable(columns, norm);
    const editor = $("#ch-editor");
    editor.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-head"><h3>2) Hareketleri Düzenle</h3><span class="hint">${norm.length} hareket</span></div>`;
    card.appendChild(et.root);
    const foot = document.createElement("div");
    foot.className = "toolbar"; foot.style.marginTop = "14px";
    const info = document.createElement("div"); info.className = "grow"; info.style.fontWeight = "700";
    const addBtn = mkBtn("+ Satır", "btn-sm");
    const saveBtn = mkBtn("📤 Kayıtları Gönder", "btn-primary");
    foot.append(info, addBtn, saveBtn);
    card.appendChild(foot);
    editor.appendChild(card);

    const recompute = () => {
      const d = et.getData();
      const borc = d.reduce((s, r) => s + parseNum(r.debit), 0);
      const alacak = d.reduce((s, r) => s + parseNum(r.credit), 0);
      info.textContent = `Toplam Borç: ${fmtTRY(borc)}  ·  Toplam Alacak: ${fmtTRY(alacak)}`;
    };
    recompute();
    editor.addEventListener("input", recompute);
    addBtn.onclick = () => { et.addRow({ date: todayISO() }); recompute(); };

    saveBtn.onclick = async () => {
      const data = et.getData().filter((r) => r.code || r.name || r.debit || r.credit);
      if (!data.length) return toast("Gönderilecek hareket yok.", "err");
      saveBtn.disabled = true;
      try {
        await batchAdd(C.currentMovements, data.map((r) => ({
          ...r, source: "uyumsoft-cari", createdAt: serverTimestamp(), createdBy: currentUser.email,
        })));
        toast(`${data.length} hareket kaydedildi.`, "ok");
        editor.innerHTML = `<div class="notice info">✔ ${data.length} cari hareket kaydedildi.</div>`;
      } catch (e) { toast("Hata: " + e.message, "err"); saveBtn.disabled = false; }
    };
  }
}

// ===========================================================================
//  MODÜL: BANKA İŞLEME
// ===========================================================================
async function viewBanka(c) {
  const bankAccounts = (await fetchAll(C.accounts).catch(() => []))
    .filter((a) => a.type === "banka");
  c.innerHTML = `
    <div class="notice info">🏦 Banka hareket dosyanızı yükleyin. Aşağıda <b>düzenleme ve ön izleme</b> ekranı oluşur;
      kontrol edip kaydedin. Seçtiğiniz <b>hedef banka hesabı</b>nın bakiyesi bu hareketlerle güncellenir.</div>
    ${bankAccounts.length ? "" : `<div class="notice warn">⚠️ Henüz <b>banka türünde hesap</b> yok. Hareketlerin bir hesaba işlenmesi için önce <a href="#/hesaplar">Hesaplar</a>'dan banka hesabı ekleyin.</div>`}
    <div class="card"><div class="card-head"><h3>1) Banka Dosyası Yükle</h3></div><div id="bk-drop"></div></div>
    <div id="bk-editor"></div>`;

  $("#bk-drop").appendChild(fileDrop(async (file) => {
    try {
      const { headers, rows } = await parseSpreadsheet(file);
      if (!rows.length) return toast("Veri bulunamadı.", "err");
      renderEditor(headers, rows);
      toast(`${rows.length} satır okundu.`, "ok");
    } catch (e) { toast("Okunamadı: " + e.message, "err"); }
  }));

  function renderEditor(headers, rows) {
    const map = {
      date: guessCol(headers, ["tarih", "date"]),
      desc: guessCol(headers, ["açıklama", "aciklama", "description", "işlem", "islem"]),
      amount: guessCol(headers, ["tutar", "amount", "işlem tutar"]),
      balance: guessCol(headers, ["bakiye", "balance"]),
    };
    const norm = rows.map((r) => {
      const amt = parseNum(r[map.amount]);
      return {
        date: excelDateToISO(r[map.date]),
        desc: r[map.desc] || "",
        type: amt >= 0 ? "gelen" : "giden",
        amount: amt,
        balance: parseNum(r[map.balance]),
      };
    });
    const columns = [
      { key: "date", label: "Tarih", type: "date" },
      { key: "desc", label: "Açıklama", type: "text" },
      { key: "type", label: "Yön", type: "select", options: [{value:"gelen",label:"Gelen"},{value:"giden",label:"Giden"}] },
      { key: "amount", label: "Tutar", type: "num" },
      { key: "balance", label: "Bakiye", type: "num" },
    ];
    const et = editableTable(columns, norm);
    const editor = $("#bk-editor");
    editor.innerHTML = "";
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<div class="card-head"><h3>2) Ön İzleme & Düzenleme</h3><span class="hint">${norm.length} hareket</span></div>`;
    card.appendChild(et.root);
    const foot = document.createElement("div"); foot.className = "toolbar"; foot.style.marginTop = "14px";
    const acctField = document.createElement("div");
    acctField.className = "field"; acctField.style.margin = "0";
    acctField.innerHTML = `<label>Hedef Banka Hesabı</label>
      <select id="bk-account">
        <option value="">(hesaba işlenmesin)</option>
        ${bankAccounts.map((a) => `<option value="${a.id}">${esc(a.code ? a.code + " · " : "")}${esc(a.name)}</option>`).join("")}
      </select>`;
    const info = document.createElement("div"); info.className = "grow"; info.style.fontWeight = "700";
    const saveBtn = mkBtn("💾 Banka Hareketlerini Kaydet", "btn-primary");
    foot.append(acctField, info, saveBtn);
    card.appendChild(foot);
    editor.appendChild(card);

    const recompute = () => {
      const d = et.getData();
      const gelen = d.filter((r) => parseNum(r.amount) >= 0).reduce((s, r) => s + parseNum(r.amount), 0);
      const giden = d.filter((r) => parseNum(r.amount) < 0).reduce((s, r) => s + parseNum(r.amount), 0);
      info.textContent = `Gelen: ${fmtTRY(gelen)}  ·  Giden: ${fmtTRY(giden)}  ·  Net: ${fmtTRY(gelen+giden)}`;
    };
    recompute();
    editor.addEventListener("input", recompute);
    saveBtn.onclick = async () => {
      const data = et.getData().filter((r) => r.date || r.desc || r.amount);
      if (!data.length) return toast("Kaydedilecek hareket yok.", "err");
      saveBtn.disabled = true;
      const acctId = $("#bk-account", editor)?.value || "";
      const acct = bankAccounts.find((a) => a.id === acctId);
      try {
        await batchAdd(C.bankTransactions, data.map((r) => ({
          ...r, source: "banka",
          accountId: acctId || null, accountCode: acct?.code || null,
          createdAt: serverTimestamp(), createdBy: currentUser.email,
        })));
        toast(`${data.length} banka hareketi kaydedildi.`, "ok");
        editor.innerHTML = `<div class="notice info">✔ ${data.length} hareket kaydedildi.</div>`;
      } catch (e) { toast("Hata: " + e.message, "err"); saveBtn.disabled = false; }
    };
  }
}

// ===========================================================================
//  MODÜL: NAKİT AKIŞ VERİLERİ (tekrarlanan gelir/gider tanımları)
// ===========================================================================
const PERIODS = [
  { value: "haftalik", label: "Haftalık" },
  { value: "aylik", label: "Aylık" },
  { value: "3aylik", label: "3 Aylık" },
  { value: "6aylik", label: "6 Aylık" },
  { value: "yillik", label: "Yıllık" },
];
const periodLabel = (v) => PERIODS.find((p) => p.value === v)?.label || v;

async function viewNakitAkisVeri(c) {
  const items = (await fetchAll(C.cashflowItems))
    .sort((a, b) => (a.type || "").localeCompare(b.type || ""));
  c.innerHTML = `
    <div class="notice info">🔄 Her dönem tekrarlanan <b>gelir ve giderlerinizi</b> buradan tanımlayın.
      Tanımladıklarınız <b>Nakit Akış Raporu</b>'nda otomatik yer alır.</div>
    <div class="toolbar">
      <div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="cf-add">+ Yeni Tanım</button>
    </div>
    <div class="card">
      <div class="card-head"><h3>Tekrarlanan Kalemler</h3><span class="hint">${items.length} kalem</span></div>
      ${items.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Ad</th><th>Tür</th><th>Dönem</th><th class="num">Tutar</th><th class="num">Aylık Karşılık</th><th>Durum</th><th></th></tr></thead>
        <tbody>${items.map((x) => `<tr>
          <td><b>${esc(x.name)}</b></td>
          <td><span class="tag ${x.type==="gelir"?"ok":"red"}">${x.type==="gelir"?"Gelir":"Gider"}</span></td>
          <td>${periodLabel(x.period)}</td>
          <td class="num">${fmtTRY(x.amount || 0)}</td>
          <td class="num">${fmtTRY(monthlyEquivalent(x))}</td>
          <td>${x.active===false?'<span class="tag warn">Pasif</span>':'<span class="tag ok">Aktif</span>'}</td>
          <td style="text-align:right">
            <button class="btn btn-sm" data-edit="${x.id}">Düzenle</button>
            <button class="btn btn-sm btn-danger" data-del="${x.id}">Sil</button>
          </td></tr>`).join("")}</tbody>
      </table></div>`
        : `<div class="empty"><div class="ico">🔄</div><p>Henüz tekrarlanan kalem tanımlanmamış.</p></div>`}
    </div>`;

  $("#cf-add").onclick = () => cfModal(null);
  $$("[data-edit]", c).forEach((b) => b.onclick = () => cfModal(items.find((x) => x.id === b.dataset.edit)));
  $$("[data-del]", c).forEach((b) => b.onclick = () =>
    confirmDialog("Kalem silinsin mi?", async () => {
      await deleteDoc(doc(db, "cashflowItems", b.dataset.del));
      toast("Silindi.", "ok"); route();
    }));
}
function cfModal(item) {
  const isNew = !item;
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="field"><label>Kalem Adı</label><input id="cf-name" value="${esc(item?.name || "")}" placeholder="Kira / Personel Maaş / Aylık Ciro" /></div>
    <div class="form-row">
      <div class="field"><label>Tür</label><select id="cf-type">
        <option value="gelir" ${item?.type==="gelir"?"selected":""}>Gelir</option>
        <option value="gider" ${item?.type==="gider"?"selected":""}>Gider</option>
      </select></div>
      <div class="field"><label>Dönem</label><select id="cf-period">
        ${PERIODS.map((p) => `<option value="${p.value}" ${item?.period===p.value?"selected":""}>${p.label}</option>`).join("")}
      </select></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Tutar (₺)</label><input id="cf-amount" class="num" value="${item?.amount ?? ""}" /></div>
      <div class="field"><label>Ayın Günü (1-31)</label><input id="cf-day" class="num" value="${item?.dayOfMonth ?? 1}" /></div>
    </div>
    <div class="field"><label><input type="checkbox" id="cf-active" ${item?.active!==false?"checked":""} style="width:auto"> Aktif</label></div>`;
  const m = openModal({
    title: isNew ? "Yeni Tekrarlanan Kalem" : "Kalemi Düzenle",
    body,
    footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Kaydet", "btn-primary", async () => {
        const payload = {
          name: $("#cf-name", body).value.trim(),
          type: $("#cf-type", body).value,
          period: $("#cf-period", body).value,
          amount: parseNum($("#cf-amount", body).value),
          dayOfMonth: Math.min(31, Math.max(1, parseInt($("#cf-day", body).value) || 1)),
          active: $("#cf-active", body).checked,
          updatedAt: serverTimestamp(),
        };
        if (!payload.name) return toast("Ad gerekli.", "err");
        try {
          if (isNew) await addDoc(C.cashflowItems(), { ...payload, createdAt: serverTimestamp() });
          else await updateDoc(doc(db, "cashflowItems", item.id), payload);
          m.close(); toast("Kaydedildi.", "ok"); route();
        } catch (e) { toast("Hata: " + e.message, "err"); }
      }),
    ],
  });
}

// ===========================================================================
//  MODÜL: NAKİT AKIŞ RAPORU (1 / 3 aylık projeksiyon)
// ===========================================================================
async function viewNakitAkisRapor(c) {
  const [items, accounts, cari, bank] = await Promise.all([
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
  ]);
  const bal = computeBalances(accounts, cari, bank);
  const startCash = accounts
    .filter((a) => a.type === "kasa" || a.type === "banka")
    .reduce((s, a) => s + (bal.get(a.id)?.current || 0), 0);
  let months = 3;

  c.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="range-seg">
        <button data-m="1">1 Aylık</button>
        <button data-m="3" class="active">3 Aylık</button>
        <button data-m="6">6 Aylık</button>
        <button data-m="12">12 Aylık</button>
      </div>
      <div class="grow"></div>
      <a class="btn btn-sm" href="#/nakit-akis-veri">🔄 Kalemleri Düzenle</a>
    </div>
    <div id="cash-report"></div>`;

  function draw() {
    const active = items.filter((x) => x.active !== false);
    const now = new Date();
    const cols = [];
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      cols.push({
        key: `${d.getFullYear()}-${d.getMonth()}`,
        label: d.toLocaleDateString("tr-TR", { month: "long", year: "numeric" }),
        monthOffset: i,
      });
    }
    const inflow = cols.map((col) => sumForMonth(active, "gelir", col.monthOffset, now));
    const outflow = cols.map((col) => sumForMonth(active, "gider", col.monthOffset, now));
    let running = startCash;
    const rows = cols.map((col, i) => {
      const net = inflow[i] - outflow[i];
      running += net;
      return { label: col.label, in: inflow[i], out: outflow[i], net, balance: running };
    });
    const totIn = inflow.reduce((a, b) => a + b, 0);
    const totOut = outflow.reduce((a, b) => a + b, 0);

    $("#cash-report").innerHTML = `
      <div class="grid cols-4">
        <div class="stat"><div class="label">Başlangıç Nakit</div><div class="value">${fmtTRY(startCash)}</div><div class="foot">Kasa + Banka</div></div>
        <div class="stat green"><div class="label">Toplam Giriş (${months} ay)</div><div class="value">${fmtTRY(totIn)}</div></div>
        <div class="stat red"><div class="label">Toplam Çıkış (${months} ay)</div><div class="value">${fmtTRY(totOut)}</div></div>
        <div class="stat"><div class="label">Dönem Sonu Nakit</div><div class="value" style="color:${running>=0?'var(--ok)':'var(--danger)'}">${fmtTRY(running)}</div></div>
      </div>
      <div class="card" style="margin-top:18px">
        <div class="card-head"><h3>Aylık Nakit Akış Projeksiyonu</h3><span class="hint">${active.length} tekrarlanan kalem baz alındı</span></div>
        ${active.length ? `<div class="table-wrap"><table class="data">
          <thead><tr><th>Dönem</th><th class="num">Giriş</th><th class="num">Çıkış</th><th class="num">Net</th><th class="num">Kümülatif Nakit</th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td><b>${esc(r.label)}</b></td>
            <td class="num" style="color:var(--ok)">${fmtTRY(r.in)}</td>
            <td class="num" style="color:var(--danger)">${fmtTRY(r.out)}</td>
            <td class="num" style="color:${r.net>=0?'var(--ok)':'var(--danger)'}">${fmtTRY(r.net)}</td>
            <td class="num"><b style="color:${r.balance>=0?'inherit':'var(--danger)'}">${fmtTRY(r.balance)}</b></td>
          </tr>`).join("")}</tbody>
          <tfoot><tr style="font-weight:700;background:var(--surface-2)">
            <td>Toplam</td><td class="num">${fmtTRY(totIn)}</td><td class="num">${fmtTRY(totOut)}</td>
            <td class="num">${fmtTRY(totIn-totOut)}</td><td class="num">${fmtTRY(running)}</td>
          </tr></tfoot>
        </table></div>
        ${miniBars(rows)}`
          : `<div class="empty"><div class="ico">📈</div><p>Projeksiyon için önce <b>Nakit Akış Verileri</b> ekleyin.</p><a class="btn btn-primary btn-sm" href="#/nakit-akis-veri">Kalem Ekle</a></div>`}
      </div>`;
  }
  $$("#range-seg button", c).forEach((b) => b.onclick = () => {
    $$("#range-seg button", c).forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); months = parseInt(b.dataset.m); draw();
  });
  draw();
}
// Bir ayın belirli türdeki toplamı (tekrarlanan kalemlerden)
function sumForMonth(items, type, monthOffset, now) {
  return items.filter((x) => x.type === type).reduce((sum, x) => {
    const per = x.period;
    if (per === "aylik" || per === "haftalik") return sum + monthlyEquivalent(x);
    if (per === "3aylik")  return sum + (monthOffset % 3 === 0 ? x.amount : 0);
    if (per === "6aylik")  return sum + (monthOffset % 6 === 0 ? x.amount : 0);
    if (per === "yillik")  return sum + (monthOffset % 12 === 0 ? x.amount : 0);
    return sum + (x.amount || 0);
  }, 0);
}
function miniBars(rows) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.in, r.out)));
  return `<div style="display:flex;gap:14px;align-items:flex-end;margin-top:18px;padding:0 4px;overflow-x:auto">
    ${rows.map((r) => `<div style="flex:1;min-width:60px;text-align:center">
      <div style="display:flex;gap:4px;align-items:flex-end;justify-content:center;height:120px">
        <div title="Giriş ${fmtTRY(r.in)}" style="width:16px;height:${(r.in/max*100)||1}%;background:var(--ok);border-radius:4px 4px 0 0"></div>
        <div title="Çıkış ${fmtTRY(r.out)}" style="width:16px;height:${(r.out/max*100)||1}%;background:var(--red);border-radius:4px 4px 0 0"></div>
      </div>
      <div style="font-size:11px;color:var(--ink-faint);margin-top:6px">${esc(r.label.split(" ")[0])}</div>
    </div>`).join("")}
  </div>
  <div style="display:flex;gap:16px;justify-content:center;margin-top:10px;font-size:12px;color:var(--ink-soft)">
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--ok);border-radius:2px"></span> Giriş</span>
    <span><span style="display:inline-block;width:10px;height:10px;background:var(--red);border-radius:2px"></span> Çıkış</span>
  </div>`;
}

// ===========================================================================
//  MODÜL: YEDEK / VERİ (yerel mod)
// ===========================================================================
const COL_LABELS = {
  users: "Kullanıcılar", accounts: "Hesaplar", dayEndRecords: "Gün Sonu Kayıtları",
  currentMovements: "Cari Hareketler", bankTransactions: "Banka Hareketleri",
  cashflowItems: "Nakit Akış Verileri",
};
async function viewYedek(c) {
  const stats = storageStats();
  const kb = (stats.bytes / 1024).toFixed(1);
  c.innerHTML = `
    <div class="notice info">💾 <b>Yerel mod aktif.</b> Tüm veriler yalnızca <b>bu tarayıcıda</b> saklanıyor.
      Veri kaybını önlemek için düzenli olarak <b>yedek indirin</b>. Firebase bağlandığında bu yedeği içe aktarabilirsiniz.</div>
    <div class="grid cols-2">
      <div class="card">
        <div class="card-head"><h3>Depolama Durumu</h3><span class="hint">${kb} KB</span></div>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Koleksiyon</th><th class="num">Kayıt</th></tr></thead>
          <tbody>${COLLECTIONS.map((n) => `<tr><td>${esc(COL_LABELS[n] || n)}</td><td class="num">${stats.counts[n] || 0}</td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Yedekle & Geri Yükle</h3></div>
        <p style="color:var(--ink-soft);font-size:13px;margin-top:0">Tüm verinizi tek bir <code>.json</code> dosyasına indirin ya da bir yedeği geri yükleyin.</p>
        <div class="toolbar" style="margin-bottom:0">
          <button class="btn btn-primary" id="yd-export">⬇️ Yedeği İndir</button>
          <button class="btn" id="yd-import-btn">⬆️ Yedeği Geri Yükle</button>
          <input type="file" id="yd-import" accept=".json" style="display:none" />
        </div>
        <hr style="border:none;border-top:1px solid var(--line);margin:18px 0" />
        <div class="notice warn" style="margin-bottom:10px">⚠️ Aşağıdaki işlem <b>tüm yerel veriyi</b> siler, geri alınamaz.</div>
        <button class="btn btn-danger btn-sm" id="yd-clear">🗑️ Tüm Veriyi Temizle</button>
      </div>
    </div>`;

  $("#yd-export").onclick = () => {
    const data = exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kubban-yedek-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Yedek indirildi.", "ok");
  };
  $("#yd-import-btn").onclick = () => $("#yd-import").click();
  $("#yd-import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      confirmDialog("Bu yedek mevcut yerel verinin ÜZERİNE yazılacak. Devam edilsin mi?", () => {
        importAll(payload, { replace: true });
        toast("Yedek geri yüklendi.", "ok");
        route();
      });
    } catch (err) { toast("Geçersiz yedek dosyası.", "err"); }
  };
  $("#yd-clear").onclick = () =>
    confirmDialog("TÜM veriler silinsin mi? Bu işlem geri alınamaz.", () => {
      clearAllData();
      toast("Tüm veri temizlendi.", "ok");
      route();
    });
}

// ---------------------------------------------------------------------------
//  ORTAK YARDIMCILAR (Excel tarih, toplu ekleme)
// ---------------------------------------------------------------------------
function excelDateToISO(v) {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") { // Excel seri tarih
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return isNaN(d) ? "" : d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const m = s.match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (m) {
    const [_, dd, mm, yy] = m;
    const y = yy.length === 2 ? "20" + yy : yy;
    return `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  return s.slice(0, 10);
}
// Firestore'a 500'lük gruplar halinde toplu ekleme
async function batchAdd(colFn, docs) {
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => batch.set(doc(colFn()), d));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
//  BAŞLAT
// ---------------------------------------------------------------------------
setupAuthUI();
if (CONFIG_READY) {
  onAuth();
} else {
  showLogin(); // config eksik → giriş ekranında uyarı gösterilir
}
