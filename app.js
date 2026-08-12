// ============================================================================
//  GÜLLÜOĞLU KÜBBAN — YÖNETİM YAZILIMI  ·  app.js
//  Saf vanilla JS (framework yok) · Firebase Auth + Firestore
// ============================================================================

// ⚙️ BULUT MOD (Supabase): Veri Supabase (Postgres) üzerinde. Yerele dönmek
// için aşağıdaki import'u "./local-backend.js" ile değiştirmek yeterli
// (fonksiyon imzaları birebir aynıdır). Ayarlar: config.js · Bkz. supabase-backend.js
import {
  initializeApp, getFirestore, collection, doc, getDoc, getDocs, addDoc, setDoc,
  updateDoc, deleteDoc, query, where, orderBy, limit, serverTimestamp, writeBatch,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, updateProfile,
  exportAll, importAll, storageStats, clearAllData, COLLECTIONS, uploadAvatar, adminUsers,
  setRevalidateHandler,
} from "./supabase-backend.js?v=2026.138";

import { COMPANY, BOOTSTRAP_ADMINS } from "./config.js?v=2026.138";

// ---------------------------------------------------------------------------
//  Kısayollar & yardımcılar
// ---------------------------------------------------------------------------
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const CONFIG_READY = true; // Yerel mod her zaman hazır

const nf  = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const z0  = (n) => (isFinite(n) && Math.abs(n) < 0.005) ? 0 : n;   // -0 ve yuvarlama artığını 0 yap
const fmtTRY = (n) => (isFinite(n) ? nf.format(z0(n)) : "0,00") + " ₺";
const fmtNum = (n) => (isFinite(n) ? nf.format(z0(n)) : "0,00");
const todayISO = () => new Date().toISOString().slice(0, 10);
function fmtDate(iso) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? iso : new Date(iso).toISOString().slice(0, 10);
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}.${m}.${y}`;
}
// Kısa tarih: 12.07.26 (2 haneli yıl)
function fmtDateShort(iso) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? iso : new Date(iso).toISOString().slice(0, 10);
  const [y, m, dd] = d.slice(0, 10).split("-");
  return `${dd}.${m}.${y.slice(-2)}`;
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

// Para alanı: ₺ ekli, binlik ayraçlı görünüm (kaydederken parseNum çözer)
function moneyField(label, id, value) {
  const v = (value !== "" && value != null) ? fmtNum(parseNum(value)) : "";
  return `<div class="field"><label>${esc(label)}</label>
    <div class="money-wrap">
      <input id="${id}" class="num money" inputmode="decimal" value="${esc(v)}" placeholder="0,00" />
      <span class="cur">₺</span>
    </div></div>`;
}
function wireMoney(root) {
  $$(".money", root).forEach((inp) => {
    inp.addEventListener("blur", () => {
      const n = parseNum(inp.value);
      inp.value = n ? fmtNum(n) : "";
    });
    inp.addEventListener("focus", () => { inp.select(); });
  });
}

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
  const backdrop = $(".modal-backdrop", root);
  const bodyEl = $(".modal-body", root);
  const footEl = $(".modal-foot", root);
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  (footer || []).forEach((b) => footEl.appendChild(b));
  let closed = false;
  // Kapanış: anında silmek yerine dışarı animasyonu (GPU) → sonra kaldır
  const close = () => {
    if (closed) return; closed = true;
    backdrop.classList.add("out");
    let fired = false;
    const done = () => {
      if (fired) return; fired = true;
      if (backdrop.parentNode) backdrop.remove();   // sadece bu modalı kaldır (yenisi açıldıysa dokunma)
      onClose && onClose();
    };
    backdrop.addEventListener("animationend", done, { once: true });
    setTimeout(done, 240);   // animationend gelmezse güvenlik
  };
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) close();
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

// Dosya okuma sırasında dolan bar (trickle). finish() ile %100 dolar ve kapanır.
function loadingBar(label) {
  const el = document.createElement("div");
  el.className = "prog-anim";
  el.innerHTML = `<div class="pa-box">
    <div class="pa-label">${esc(label || "Yükleniyor…")}</div>
    <div class="pa-track"><div class="pa-fill"></div></div>
  </div>`;
  document.body.appendChild(el);
  const fill = $(".pa-fill", el);
  requestAnimationFrame(() => { fill.classList.add("trickle"); fill.style.width = "88%"; });
  const t0 = Date.now();
  return {
    finish(onDone) {
      const go = () => {
        fill.style.transition = "width .25s ease"; fill.style.width = "100%";
        setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); onDone && onDone(); }, 220); }, 240);
      };
      const wait = Math.max(0, 350 - (Date.now() - t0));   // en az görünsün
      setTimeout(go, wait);
    },
  };
}

// Belirlenebilir (deterministik) ilerleme çubuğu — set(pct,msg) ile sürülür.
// Uzun toplu işlerde (ör. 27.000 satır aktarımı) gerçek yüzde gösterir.
function progressBar(label) {
  const el = document.createElement("div");
  el.className = "prog-anim";
  el.innerHTML = `<div class="pa-box">
    <div class="pa-label">${esc(label || "İşleniyor…")}</div>
    <div class="pa-track"><div class="pa-fill" style="width:0%"></div></div>
    <div class="pa-sub"></div>
  </div>`;
  document.body.appendChild(el);
  const fill = $(".pa-fill", el), sub = $(".pa-sub", el);
  fill.style.transition = "width .18s ease";
  return {
    set(pct, msg) {
      fill.style.width = Math.max(0, Math.min(100, pct)) + "%";
      if (msg != null) sub.textContent = msg;
    },
    done(cb) {
      fill.style.width = "100%";
      setTimeout(() => { el.classList.add("out"); setTimeout(() => { el.remove(); cb && cb(); }, 220); }, 220);
    },
  };
}

// Tamamlama animasyonu: dolan bar → animasyonlu ✓
// Tüm hareket GPU'da (transform/opacity), zamanlama CSS'te — ana iş parçacığı
// meşgul olsa bile kasmaz. Başlangıç çift rAF ile: sonrasındaki DOM işi bitsin.
function successAnim(message, onDone) {
  const el = document.createElement("div");
  el.className = "success-anim";
  el.innerHTML = `
    <div class="sa-box">
      <div class="sa-stage">
        <div class="sa-track"><div class="sa-fill"></div></div>
        <svg class="sa-check" viewBox="0 0 52 52" aria-hidden="true">
          <circle class="sa-circle" cx="26" cy="26" r="24"></circle>
          <path class="sa-tick" d="M14 27 l8 8 l16 -18"></path>
        </svg>
      </div>
      ${message ? `<div class="sa-msg">${esc(message)}</div>` : ""}
    </div>`;
  document.body.appendChild(el);
  const box = $(".sa-box", el);
  requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("go")));
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => { el.remove(); onDone && onDone(); }, 240);
  }, 1350);
}

// Aranabilir hesap seçici (fatura + banka aktarımında ortak, uygulama tasarımlı)
// opts: { accounts:[leaf], title, allowNew, query, fixedNewName, onPick({acc}|{newName}) }
//   fixedNewName verilirse: arama BOŞ açılır, "yeni hesap aç" hep bu adı kullanır (yazılana bakmaz)
function openAccountPicker({ accounts = [], title = "Hesap Seç", allowNew = true, query = "", fixedNewName = "", newWord = "yeni hesap", onPick }) {
  const body = document.createElement("div");
  body.className = "ap";
  body.innerHTML = `
    <input class="ap-search" type="search" placeholder="🔍 Ara — ad ya da kod" value="${esc(query)}" autocomplete="off" />
    <div class="ap-list"></div>`;
  const m = openModal({ title, body, footer: [mkBtn("Vazgeç", "", () => m.close())] });
  const search = $(".ap-search", body), list = $(".ap-list", body);
  const pick = (res) => { m.close(); onPick && onPick(res); };
  function render() {
    const raw = search.value.trim(), q = normTr(raw);
    const hits = (!q ? accounts.slice(0, 40)
      : accounts.filter((a) => normTr((a.code || "") + " " + (a.name || "")).includes(q)).slice(0, 60));
    const newName = fixedNewName || raw;   // sabit ad varsa onu, yoksa yazılanı
    list.innerHTML =
      hits.map((a) => `<button class="ap-item" data-id="${a.id}">
          <span class="ap-code">${esc(a.code || "")}</span>
          <span class="ap-name">${esc(a.name || "")}</span>
        </button>`).join("")
      + (allowNew && newName ? `<button class="ap-item ap-new" data-new="1">➕ "<b>${esc(titleCase(newName))}</b>" adıyla <b>${esc(newWord)}</b> aç</button>` : "")
      + (!hits.length && !raw ? `<div class="ap-empty">Aramak için yaz…${allowNew && newName ? " ya da alttan yeni aç." : ""}</div>` : (!hits.length && raw && !allowNew ? `<div class="ap-empty">Eşleşen hesap yok.</div>` : ""));
    $$(".ap-item", list).forEach((b) => b.onclick = () =>
      b.dataset.new ? pick({ newName }) : pick({ acc: accounts.find((a) => a.id === b.dataset.id) }));
  }
  search.addEventListener("input", render);
  render();
  setTimeout(() => search.focus(), 60);
}

// Rapor kodu seçici — hesap seçici ile aynı pencere (grup·kod listesi, aranabilir)
function openRaporPicker({ raporItems = [], query = "", onPick }) {
  const accounts = raporItems.map((r) => ({ id: `${r.grup}||${r.ad}`, code: r.grup, name: r.ad }));
  openAccountPicker({
    accounts, title: "Rapor Kodu Seç", allowNew: true, query, newWord: "yeni rapor kodu",
    onPick: (res) => onPick && onPick(res.acc ? res.acc.name : res.newName),
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
  accountEntries:   () => collection(db, "accountEntries"),
  dayEndRecords:    () => collection(db, "dayEndRecords"),
  currentMovements: () => collection(db, "currentMovements"),
  bankTransactions: () => collection(db, "bankTransactions"),
  cashflowItems:    () => collection(db, "cashflowItems"),
  settings:         () => collection(db, "settings"),
  auditLog:         () => collection(db, "auditLog"),
};

// Değişiklik kaydı: kim, ne zaman, hangi işlem, hangi kayıt
async function logAction(action, entity, label) {
  try {
    await addDoc(C.auditLog(), {
      user: currentUser?.email || "?",
      userName: currentUser?.displayName || "",
      action, entity, label: label || "",
      at: new Date().toISOString(),
    });
  } catch (_) { /* log hatası işlemi engellemesin */ }
}

// ---------------------------------------------------------------------------
//  Durum
// ---------------------------------------------------------------------------
let currentUser = null;      // { uid, email, displayName, role }
const isAdmin = () => currentUser && currentUser.role === "admin";

// Aktarım sonrası cari inceleme turu
let reviewQueue = null;       // { ids: [...], index: 0 }
let reviewKeyHandler = null;  // Enter dinleyicisi
let ledgerFitHandler = null;  // defter yükseklik kilidi (resize dinleyicisi)
function advanceReview() {
  if (!reviewQueue) return;
  reviewQueue.index++;
  if (reviewQueue.index >= reviewQueue.ids.length) {
    const after = reviewQueue.after;
    reviewQueue = null;
    toast("Tüm hesaplar incelendi. ✔", "ok");
    if (after) after(); else location.hash = "#/hesaplar";
  } else {
    location.hash = "#/hesap-detay?id=" + reviewQueue.ids[reviewQueue.index];
  }
}
function finishReview() {   // "Bitir": incelemeyi bırak, varsa son adıma (bloke kontrolü) geç
  if (!reviewQueue) { location.hash = "#/hesaplar"; return; }
  const after = reviewQueue.after;
  reviewQueue = null;
  if (after) after(); else location.hash = "#/hesaplar";
}

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
  renderAvatar();
  const roleEl = $("#user-role");
  roleEl.textContent = isAdmin() ? "Yönetici" : "Kullanıcı";
  roleEl.classList.toggle("user", !isAdmin());
  const foot = $(".sidebar-foot");
  if (foot) foot.textContent = `Sürüm ${APP_VERSION} · Bulut (Supabase)`;
  buildNav();
  if (!location.hash) location.hash = "#/dashboard";
  route();
}
// ---- Profil fotoğrafı / kullanıcı menüsü ----
function avatarInner(u = currentUser, cls = "") {
  if (u?.photoURL) return `<img class="${cls}" src="${esc(u.photoURL)}" alt="" />`;
  return esc((u?.displayName || u?.email || "?").trim().charAt(0).toUpperCase());
}
function renderAvatar() { const el = $("#user-avatar"); if (el) el.innerHTML = avatarInner(); }

// Görseli tarayıcıda küçült (kare, ~256px, jpeg) → küçük dosya, hızlı yükleme
function resizeImage(file, max = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);       // kare kırp (ortadan)
      const sx = (img.width - side) / 2, sy = (img.height - side) / 2;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = max;
      canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, max, max);
      canvas.toBlob((b) => b ? resolve(b) : reject(new Error("Görsel işlenemedi")), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Görsel okunamadı")); };
    img.src = url;
  });
}
async function changeAvatar(file) {
  const blob = await resizeImage(file, 256);
  const url = await uploadAvatar(blob, currentUser.uid);
  await updateDoc(doc(db, "users", currentUser.uid), { photoURL: url });
  currentUser.photoURL = url;
  renderAvatar();
}
async function removeAvatar() {
  await updateDoc(doc(db, "users", currentUser.uid), { photoURL: "" });
  currentUser.photoURL = "";
  renderAvatar();
}
function openProfileModal() {
  const body = document.createElement("div");
  body.className = "prof";
  const draw = () => {
    body.innerHTML = `
      <div class="prof-head">
        <div class="prof-av">${avatarInner()}</div>
        <div class="prof-info">
          <div class="prof-name">${esc(currentUser.displayName || "")}</div>
          <div class="prof-mail">${esc(currentUser.email || "")}</div>
          <span class="role-badge${isAdmin() ? "" : " user"}">${isAdmin() ? "Yönetici" : "Kullanıcı"}</span>
        </div>
      </div>
      <div class="prof-actions">
        <button class="btn btn-sm" id="prof-photo">📷 Fotoğraf ${currentUser.photoURL ? "Değiştir" : "Ekle"}</button>
        ${currentUser.photoURL ? `<button class="btn btn-sm" id="prof-rm">Kaldır</button>` : ""}
      </div>
      <input type="file" id="prof-file" accept="image/*" style="display:none" />`;
    $("#prof-photo", body).onclick = () => $("#prof-file", body).click();
    $("#prof-file", body).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      const lb = loadingBar("Fotoğraf yükleniyor…");
      try { await changeAvatar(f); lb.finish(() => { draw(); toast("Profil fotoğrafı güncellendi.", "ok"); }); }
      catch (err) { lb.finish(() => toast("Yüklenemedi: " + err.message, "err")); }
    };
    const rm = $("#prof-rm", body);
    if (rm) rm.onclick = async () => {
      try { await removeAvatar(); draw(); toast("Fotoğraf kaldırıldı.", "ok"); }
      catch (err) { toast("Hata: " + err.message, "err"); }
    };
  };
  draw();
  const m = openModal({ title: "Profil", body, footer: [
    mkBtn("Çıkış Yap", "btn-danger", () => { m.close(); confirmDialog("Oturumu kapatmak istiyor musunuz?", () => signOut(auth)); }),
    mkBtn("Kapat", "", () => m.close()),
  ]});
}
$("#user-chip").addEventListener("click", openProfileModal);

// ---------------------------------------------------------------------------
//  MOBİL MENÜ (kayan çekmece)
// ---------------------------------------------------------------------------
function closeDrawer() {
  $("#sidebar")?.classList.remove("open");
  $("#sidebar-overlay")?.classList.remove("show");
}
function toggleDrawer() {
  const s = $("#sidebar"), o = $("#sidebar-overlay");
  const open = !s.classList.contains("open");
  s.classList.toggle("open", open);
  o?.classList.toggle("show", open);
}
$("#menu-toggle")?.addEventListener("click", toggleDrawer);
$("#sidebar-overlay")?.addEventListener("click", closeDrawer);

// ---------------------------------------------------------------------------
//  NAVİGASYON & YÖNLENDİRME (ROUTER)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
//  SÜRÜM & GÜNCELLEME GEÇMİŞİ
//  Sürümleme düzeni: YIL.NO  ·  2026.02'den başlar, her yeni sürümde artar.
//  Yeni sürüm çıktığında: APP_VERSION'ı güncelle ve CHANGELOG'un EN BAŞINA ekle.
// ---------------------------------------------------------------------------
const APP_VERSION = "2026.139";
const CHANGELOG = [
  { version: "2026.139", date: "2026-08-12", items: [
    "🔧 Cari Geçmişi: 'Düzeltme dosyası' — indirilen eşleşmeyenler CSV'sine eklediğiniz 'yapılacaklar' sütununa göre şahısları elle yönlendirir. KOY → En Yakın Kod'daki hesaba, hesap adı yazılırsa → o hesaba, KOYMA/boş → dokunulmaz (grupta yeni cari açılır)",
    "İndirilen eşleşmeyenler CSV'sinde artık hazır boş bir 'yapılacaklar' sütunu var — doldurup geri yükleyin (döngü tam kapanır)",
    "CSV okuyucu (parseDSV): ';' ayraçlı, tırnaklı, BOM'lu dosyaları güvenle okur",
  ]},
  { version: "2026.138", date: "2026-08-12", items: [
    "🔴 Kritik eşleşme düzeltmesi: hesap adlarındaki görünmez 'U+0307' (İ.toLowerCase() → i+nokta) yüzünden binlerce cari eşleşmiyordu. normTr artık birleşen aksanları siliyor — mevcut kayıtlar bile yeniden yüklemeden eşleşir (2264 → 32 eşleşmeyen)",
    "titleCase de temizlendi — yeni içe aktarımlarda hesap adları görünmez nokta içermez",
  ]},
  { version: "2026.137", date: "2026-08-11", items: [
    "Cari Geçmişi: '⬇️ Eşleşmeyenleri indir (CSV)' — her eşleşmeyen şahsın satır sayısı + en yakın mevcut hesap + benzerlik % ile; neden bulunamadığı görünür",
    "Cari Geçmişi: noktalama/boşluk farkı olan isimler için ikinci tur eşleşme (yalnız TEKil ve kesin olanlar) — ör. 'Av. Uğur Ayaz' ↔ 'Av.Uğur Ayaz'",
  ]},
  { version: "2026.136", date: "2026-08-11", items: [
    "Toplu Cari: Hesap Türü BOŞ cariler artık atlanmıyor — '321 Tanımlanmamış Cariler' altında (açılış 0) açılıyor; grup seçilebilir, sonra değiştirilebilir",
    "Toplu Cari: 3600+ hesap toplu (writeBatch) yazılıyor — çok daha hızlı",
    "Doğrulama (veri kaybı kontrolü): içe aktarma sonrası yazılan kayıt sayısı ve tüm cari isimleri DB'den doğrulanıyor — eksik varsa uyarı; hem Toplu Cari hem Cari Geçmişi",
  ]},
  { version: "2026.135", date: "2026-08-11", items: [
    "Cari Geçmişi: eşleşmeyen şahıslar artık ATLANMIYOR — 'Eşleşmeyenleri otomatik cari aç' ile (seçtiğin grup altında, açılış 0) yeni cari oluşturulup hareketleri ekleniyor. Böylece hareketi olup programda olmayan cari kalmıyor",
  ]},
  { version: "2026.134", date: "2026-08-11", items: [
    "Cari Geçmişi: eşleşme havuzu artık TÜM alt hesapları kapsıyor (108 bloke, 336, 128 dahil) — sadece 120/320 değil; böylece bloke/tedarikçi şahısları da eşleşir",
  ]},
  { version: "2026.133", date: "2026-08-11", items: [
    "Toplu Cari: artık TÜM hesap kodları (108 dahil) oluşturuluyor; yalnızca Hesap Türü (hesap kodu) boş satırlar atlanıyor",
    "Toplu Cari: güncel bakiye ALINMIYOR — açılış 0 eklenir, bakiye hesap hareketlerinden otomatik hesaplanır (mevcut hesabın bakiyesine dokunulmaz)",
  ]},
  { version: "2026.132", date: "2026-08-11", items: [
    "🧹 Grup Temizle (Hesaplar → ✏️ Düzenle → 🧹 Grup Temizle): 320/120/128 gibi grupların verilerini toplu temizle — (A) alt hesaplar + hareketler silinir (başlık kalır) ya da (B) sadece hareketler silinir. Önizleme + onay ile; yönetici",
  ]},
  { version: "2026.131", date: "2026-08-11", items: [
    "İçe aktarımda başlık satırı akıllıca bulunuyor — dosya tepesinde başlık bandı / yanda menü metni olsa da sütunlar tanınıyor (Toplu Cari, Fatura)",
  ]},
  { version: "2026.130", date: "2026-08-11", items: [
    "Toplu Cari: daha çok hesap türü destekleniyor (128, 335 ve genel 1xx→müşteri / 3xx→tedarikçi; 108 hariç) — daha az satır atlanıyor",
  ]},
  { version: "2026.129", date: "2026-08-11", items: [
    "🧾 Cari Geçmişi İçe Aktar: cari (120/320) borç/alacak hareketleri Excel'den yüklenir — satırlar ŞAHIS adına göre mevcut carilere eşleşir (açılış 0)",
    "Eşleşmeyen şahıslar uyarıyla listelenir; tekrar yüklemede öncekiler silinir",
  ]},
  { version: "2026.128", date: "2026-08-11", items: [
    "Banka Geçmişi: her banka için Açılış Bakiyesi elle girilir; Son Bakiye anında hesaplanır (dosyadaki bakiye sütunu net tutar olduğundan güvenilir değildi)",
  ]},
  { version: "2026.127", date: "2026-08-11", items: [
    "🏦 Banka Geçmişi İçe Aktar: tek Excel'den Garanti (102.01) ve Türkiye Finans (102.02) birlikte yüklenir",
    "BANKA sütununa göre ayrılır; her banka kendi açılış/yürüyen bakiyesiyle, dosyadaki Banka Bakiyesi ile doğrulanır",
  ]},
  { version: "2026.126", date: "2026-08-11", items: [
    "⚡ Bellek önbelleği: veriler bir kez yüklenir, sonraki sayfa geçişleri anında olur",
    "Veriler arka planda sessizce tazelenir; ekleme/düzenleme sonrası otomatik güncellenir",
    "Sayfa yüklenirken üstte ince ilerleme çubuğu (yalnız gerçekten beklerken görünür)",
  ]},
  { version: "2026.125", date: "2026-08-11", items: [
    "Hesap Defteri: dip toplamda yalnız Güncel Bakiye gösteriliyor (Giren/Çıkan toplamları kaldırıldı)",
    "Üstteki hesap kartı sabitlendi — sayfa değiştirince artık küçülmüyor",
  ]},
  { version: "2026.124", date: "2026-08-11", items: [
    "Hesap Defteri: sütun genişlikleri sabitlendi — sayfalar arası geçişte başlık artık daralmıyor (Açıklama gerekince alta sarar)",
  ]},
  { version: "2026.123", date: "2026-08-11", items: [
    "Hesap Defteri: arama çubuğu daraltıldı, sayfalama aynı satıra alındı (‹ sayfa/no › — ortada no, iki yanında ok)",
    "Kayıt sayısı/aralık yazıları kaldırıldı (sade görünüm)",
  ]},
  { version: "2026.122", date: "2026-08-11", items: [
    "Hesap Defteri: '+ Yeni Hareket' kaldırıldı; 'Geri' artık üstte başlığın yanında ok (←) olarak",
  ]},
  { version: "2026.121", date: "2026-08-11", items: [
    "Hesap Defteri: '← Hesaplar' ve '+ Yeni Hareket' düğmeleri hesap kartının içine alındı",
    "Defter ekran yüksekliğine kilitlendi: üst kısım sabit, yalnız tablo içi kayar (sayfa kaymaz)",
  ]},
  { version: "2026.120", date: "2026-08-11", items: [
    "Tablolar: fare tekerleği artık tablo üzerindeyken de kaydırıyor",
    "Tablo başlıkları (ve 'Toplam' satırı) kaydırınca üstte/altta yapışık kalıyor",
    "Hesap Defteri'ne arama + tarih aralığı filtresi (tüm kayıtlarda arar, süzüp sayfalar)",
  ]},
  { version: "2026.119", date: "2026-08-11", items: [
    "⚡ Performans: hesap defteri artık sayfalı (100'erlik) — 27.000 satırda bile akıcı kayar",
    "⚡ Veri çekişi paralelleştirildi: büyük tablolar (binlerce kayıt) çok daha hızlı yükleniyor",
    "Defter altına/üstüne sayfa gezinme çubuğu (İlk · Önceki · Sonraki · Son)",
  ]},
  { version: "2026.118", date: "2026-08-11", items: [
    "Kullanıcı yönetimi 'Yetkisiz (giriş yok)' hatası giderildi (oturum token'ı Edge Function'a açıkça gönderiliyor)",
  ]},
  { version: "2026.117", date: "2026-08-11", items: [
    "📒 Kasa Geçmişi İçe Aktar: 100 Kasa hesabının eski hareketleri Excel'den yüklenebiliyor (yönetici)",
    "Açılış bakiyesi otomatik hesaplanıyor; yürüyen bakiye dosyadaki 'Güncel Tutar' ile doğrulanıyor",
    "Büyük aktarımlarda gerçek yüzdeli ilerleme çubuğu (parça parça, kasmadan)",
  ]},
  { version: "2026.116", date: "2026-08-11", items: [
    "Kullanıcı yönetimi Edge Function bağlantısı düzeltildi (fonksiyon adı eşleşmesi)",
  ]},
  { version: "2026.115", date: "2026-08-11", items: [
    "Yönetici 'Kullanıcılar' sayfası (Sistem): uygulama içinden kullanıcı oluştur/sil, rol ve şifre değiştir",
    "Kullanıcı işlemleri güvenli Supabase Edge Function ile yapılıyor (gizli anahtar tarayıcıya sızmaz)",
  ]},
  { version: "2026.114", date: "2026-08-11", items: [
    "Kullanıcı profil fotoğrafı: sağ üstteki isme tıkla → Profil → Fotoğraf Ekle (Supabase Storage)",
  ]},
  { version: "2026.113", date: "2026-08-11", items: [
    "☁️ Bulut moda geçildi: veriler artık Supabase'te saklanıyor ve cihazlar arası paylaşılıyor",
    "Yedek Al / Yedek Yükle bulut (async) çalışacak şekilde güncellendi",
  ]},
  { version: "2026.112", date: "2026-08-11", items: [
    "Garanti POS satırları da T.Finans gibi 'Bloke Çözüm' / '… Çözüldü' olarak adlandırılıyor (defterde de)",
  ]},
  { version: "2026.111", date: "2026-08-11", items: [
    "T.Finans önizlemesi tek düz liste oldu (blokeye alma / çözümler ayrı bölüm değil)",
    "T.Finans satır sırası dosyadaki sıranın tersi (son işlem üstte değil, ilk üstte)",
  ]},
  { version: "2026.110", date: "2026-08-11", items: [
    "Açıklama artık kırpılmadan tam görünüyor (kalem simgesi kalktı, metne tıkla → düzenle)",
    "Banka Açıklaması tek satır (kırpılı); üstüne tıklayınca genişleyip tamamını gösteriyor",
  ]},
  { version: "2026.109", date: "2026-08-11", items: [
    "Açıklama kolonu tek satır (kelime kelime kaymıyor); Banka Açıklaması sarmalı",
    "POS komisyonları Rapor'da otomatik 'POS Komisyonu' olarak görünüyor ve öyle kaydediliyor",
  ]},
  { version: "2026.108", date: "2026-08-11", items: [
    "Banka önizlemesinde 'yatış günü' ara başlık satırları kaldırıldı",
    "İlgili Hesap, Rapor ve Açıklama artık kutu değil düz metin — üstüne tıklayınca düzenleniyor",
    "Açıklamadaki çift kutu/metin sorunu giderildi (özel açıklama sadece tıklayınca açılır)",
  ]},
  { version: "2026.107", date: "2026-08-11", items: [
    "Banka önizleme kolonları yenilendi: İşlem No kalktı, 'Şahıs' → 'İlgili Hesap', ayrı 'Banka Açıklaması' kolonu ve 'Güncel Bakiye' kolonu (102 bankanın yürüyen bakiyesi)",
    "POS'ta İlgili Hesap = Garanti/T.Finans Bloke; Tarih = yatış günü, çekim tarihi açıklamada; komisyon ayrı satır",
    "Dolan alanlar artık yeşil kutu değil, normal görünüyor; özel açıklama Açıklama hücresinin içinde",
  ]},
  { version: "2026.106", date: "2026-08-11", items: [
    "Banka önizleme tablosu defterle birebir kolonlar: İşlem No · Tarih · İşlem Adı · Şahıs · Açıklama · Rapor · Giren Tutar · Çıkan Tutar (yeşil/kırmızı)",
    "Hesap seçici 'Şahıs' kolonunda; tutar tek kolon yerine Giren/Çıkan olarak ikiye ayrıldı",
  ]},
  { version: "2026.105", date: "2026-08-11", items: [
    "Banka önizleme tablosu, hesap defteriyle birebir aynı başlık/stil (table.data) kullanıyor",
  ]},
  { version: "2026.104", date: "2026-08-11", items: [
    "Banka önizlemesi gerçek tabloya çevrildi (hesap defteri gibi) — PC'de tablo, mobilde kart",
    "Rapor Kodu seçimi de hesap seçici gibi aranabilir pencerede açılıyor",
    "Aktarım önizlemesinde alttaki bloke kontrolü kaldırıldı (artık inceleme sonrası pencerede)",
  ]},
  { version: "2026.103", date: "2026-08-11", items: [
    "Banka önizlemesi PC'de tablo, mobilde kart görünümünde (Garanti + T.Finans)",
    "Banka aktarımından sonra hesaplar tek tek incelenir; eklenen kayıt sarı vurgulanır (faturada da düzeldi)",
    "Hesap incelemesi bitince bloke kontrolü penceresi açılır (Garanti + T.Finans)",
    "Bankayı seçince doğrudan dosya seçme açılır (üstteki yükleme kutusu kalktı)",
    "Pencereler (modal) artık akıcı açılıp kapanıyor — kasma yok",
  ]},
  { version: "2026.102", date: "2026-08-11", items: [
    "Tamamlama animasyonu tamamen GPU'da çalışacak şekilde yeniden yazıldı — aktarım bitişinde artık kasmıyor, akıcı",
  ]},
  { version: "2026.101", date: "2026-08-11", items: [
    "Dosya yüklerken akıcı 'dolan bar' göstergesi (fatura, banka Garanti/T.Finans, toplu cari, gün sonu)",
    "Tamamlama animasyonu artık dolan bar → animasyonlu ✓ şeklinde",
  ]},
  { version: "2026.100", date: "2026-08-11", items: [
    "İçe aktarım/işlem tamamlanınca animasyonlu ✓ (fatura, banka Garanti/T.Finans, toplu cari, gün sonu)",
  ]},
  { version: "2026.99", date: "2026-08-11", items: [
    "Fatura eşleştirme sadeleşti: 'Yeni' düğmesi kalktı, tek 'Eşleştir / Ekle'. Seçici boş açılır (ara), bulamazsan alttaki 'fatura adıyla yeni hesap aç' ile tek tıkta ekler",
    "Pencere (modal) açılışı akıcılaştı; seçici yüksekliği sabit tutuldu (filtrelerken kasma yok)",
  ]},
  { version: "2026.98", date: "2026-08-11", items: [
    "Fatura: türe basınca direkt dosya seçme açılıyor (üstteki yükleme kutusu kalktı, ince çubuk + 'Başka Dosya')",
    "Fatura önizleme tablosunda Fatura No en sağda ve tam görünüyor (kısaltma yok)",
    "Cari eşleştirme artık tüm hesaplarda arıyor (sadece cari değil)",
  ]},
  { version: "2026.97", date: "2026-08-11", items: [
    "Fatura önizlemesi hesap defteri gibi: PC'de satırlı tablo (Cari · Fatura No · Tarih · Durum · Borç · Alacak), mobilde kart. Kontrol vurgusu iki görünümde de çalışır",
  ]},
  { version: "2026.96", date: "2026-08-11", items: [
    "Alış faturasında açık/kapalı sorulmuyor; doğrudan önizleme (hepsi açık/borç). Satışta sihirbaz kalıyor",
    "Cari eşleşmeyince iki seçenek: 🔗 Eşleştir (mevcut hesabı aranabilir listeden seç) + ➕ Yeni. Eşleştirilen ad hesaba hatırlatma olarak eklenir",
    "İşlem sonrası özet bildirim: alış → 'bugün X borçlandın', satış → 'X veresiye · Y tahsil'. Kontrol sırasında sıradaki fatura satırı renkle vurgulanır",
    "Tanımlamalar (Gider Grupları, Nakit Akış Verileri) Sistem menüsüne taşındı",
    "Banka aktarımında hesap seçimi: tarayıcı datalist'i yerine uygulama-içi aranabilir seçici (Garanti + T.Finans)",
  ]},
  { version: "2026.95", date: "2026-08-10", items: [
    "Supabase altyapısı hazırlandı: supabase-backend.js (local-backend ile birebir API), supabase-setup.sql (tablolar + RLS), SUPABASE.md rehberi. Geçince veri buluta taşınır — app.js tek satır import değişir (henüz aktif değil)",
  ]},
  { version: "2026.94", date: "2026-08-10", items: [
    "Fatura sihirbazı: Satış faturasında Enter/varsayılan artık 'Kapalı' (tahsil edildi); Alış faturasında 'Açık' kalır",
  ]},
  { version: "2026.93", date: "2026-08-10", items: [
    "Fatura cari eşleştirme güçlendi: artık 'önek' yerine kelime-örtüşmesi — kayıt ile fatura adı arasındaki kelime sırası/orta kelime farkları eşleşmeyi bozmuyor (farklı firmalar yine eşleşmez)",
  ]},
  { version: "2026.92", date: "2026-08-10", items: [
    "Fatura cari eşleştirme düzeltildi: ı/i ve ş/s gibi harf farkları artık eşleşmeyi bozmuyor (ASCII katlamalı normTr). Coşkun, Atlas Ship Supply gibi mevcut cariler artık bulunuyor",
  ]},
  { version: "2026.91", date: "2026-08-10", items: [
    "Fatura Aktarımı: önce Alış/Satış seçtiriyor, sonra dosya yükletiyor (tür seçimi başta)",
    "Fatura cari eşleştirme güçlendi: şirket eklerini (A.Ş./Ltd/Şti/San/Tic…) yok sayıp çekirdek isimle eşler, tüm cari hesaplarda arar — mevcut cariyi bulamayıp tekrar açma sorunu giderildi",
  ]},
  { version: "2026.90", date: "2026-08-10", items: [
    "Hesap sıralaması gruba göre: 320 Tedarikçiler ve 336 Diğer Çeşitli Borçlar küçükten büyüğe (en büyük borç üstte); diğer gruplar büyükten küçüğe",
  ]},
  { version: "2026.89", date: "2026-08-10", items: [
    "'-0,00' düzeltildi: sıfıra yuvarlanan/negatif sıfır tutarlar artık '0,00' gösteriliyor",
    "Alt hesap sıralaması işaretli oldu: büyükten küçüğe artık eksi değerleri dikkate alıyor (pozitifler üstte, negatifler altta)",
    "Toplu Cari: dosya bakiyesi tek biçimli sayılıyor — (+) = Alacak, (−) = Borç (120 dahil tüm türler). Aynı dosyayı yeniden yükleyince düzelir",
  ]},
  { version: "2026.88", date: "2026-08-10", items: [
    "Toplu Cari İçe Aktar düzeltmesi: kaynak bakiyedeki eksi işareti korunuyor — 320'de −tutar artık Borç bakiye (senin alacağın), +tutar Alacak bakiye. Eksi/parantez biçimleri de tanınır. Aynı dosyayı yeniden yükleyince düzelir",
  ]},
  { version: "2026.87", date: "2026-08-10", items: [
    "Hesap planında alt hesaplar bakiyeye göre büyükten küçüğe sıralanıyor (en yüksek tutar üstte)",
  ]},
  { version: "2026.86", date: "2026-08-10", items: [
    "Toplu Cari İçe Aktar (Hesaplar → 📥 Toplu Cari): Excel/CSV yükle → cariler + açılış bakiyeleriyle otomatik oluşur/güncellenir",
    "Sütunlar: Cari No · Cari Adı · Bakiye · Hesap Türü. 320/336 borçlusun (Alacak bakiye), 120 alacağın (Borç bakiye). 336 için 'Diğer Çeşitli Borçlar' grubu otomatik açılır",
  ]},
  { version: "2026.85", date: "2026-08-10", items: [
    "Banka/kasa (102/100) hareket kartı yeniden dizildi: üstte şahıs, altında işlem adı, en altta tarih (şahıs yoksa işlem adı üste geçer)",
  ]},
  { version: "2026.84", date: "2026-08-10", items: [
    "Cari (120/320) hareket kartı yeniden dizildi: üstte cari/mağaza adı, altında neyle ödendiği (ör. 'T. Finans ile ödendi'), en altta tarih",
    "Banka ödemelerinin karşı kaydı artık cari adını üste, ödeme yöntemini açıklamaya yazıyor (Garanti + T.Finans)",
  ]},
  { version: "2026.83", date: "2026-08-10", items: [
    "T. Finans kart harcamalarına 'Hesap' seçimi eklendi (fatura gibi): mağaza mevcut hesaplardan seçilir veya yeni eklenir; ödeme 102'den çıkıp seçilen cariyi kapatır (tedarikçiye ödeme → 320 borç)",
    "Mağaza→hesap+rapor hafızası tüm bankalarla ortaklaştı (banka-diger); daha önce eşlenen mağaza otomatik gelir",
  ]},
  { version: "2026.82", date: "2026-08-10", items: [
    "T. Finans yapısı düzeltildi: bloke borç Gün Sonu'ndan gelir. Banka aktarımında 'Blokeye Alma' 108 blokeyi kapatıp 102'ye 'Çekim Çözüldü' olarak girer + gün sonu 108 borcuyla kontrol eder",
    "'Erken Bloke Çözüm' artık 102 T.Finans Banka'dan normal harcama (kart eşleştirme + Rapor). Fazla ayaklar kaldırıldı",
  ]},
  { version: "2026.81", date: "2026-08-10", items: [
    "T. Finans bloke çözümü artık Garanti gibi: blokeden çözülüp 102.02 T.Finans Banka'ya alınır, kart harcaması bankadan çıkar (banka hesabı hareketi görür, gider yine Durum Raporu'na düşer)",
  ]},
  { version: "2026.80", date: "2026-08-10", items: [
    "Banka Aktarımı: T. Finans eklendi. Hesap (bloke) + kart dosyalarını yükleyip bloke çözümlerini kart harcamalarıyla otomatik eşleştirir (aynı gün + birebir tutar), ters kayıtları netler",
    "Eşleşen harcamaya gider grubu (Rapor) — mağaza daha önce girildiyse otomatik, değilse elle. Eşleşmeyenler için elle kart seçimi/rapor",
    "Blokeye Alma satırları, yatışın 1 gün öncesine 'Gün Sonu' bloke girişi olarak yazılır; çözümler blokeden düşüp Durum Raporu giderlerine gider",
  ]},
  { version: "2026.79", date: "2026-08-09", items: [
    "Kâr / Zarar Durumu → 'Durum Raporu'na dönüştü: basit dille bilanço. Ay seçici (Tüm Zamanlar / aylık) eklendi",
    "Dönem başında elindeki para + alacak + BORÇ ve net varlık; dönem içi kazanç/harcama; sonunda 2 sütunlu Durum Tablosu (Neyin Var / Ne Borcun Var) ve net",
  ]},
  { version: "2026.78", date: "2026-08-09", items: [
    "Yeni rapor: Kâr / Zarar Durumu — muhasebe bilmeyen için hikâye gibi, bol emojili özet (başta ne vardı, ne kazandın, blokede bekleyen/direkt gelen, çözülen blokeler, gider grupları aç-kapa, borçlar/alacaklar ve 'dükkanı kapatsan cebinde kalan')",
  ]},
  { version: "2026.77", date: "2026-08-08", items: [
    "Banka aktarımı POS-dışı 'Rapor' alanı artık Gider Grupları kalemlerinden seçiliyor (yazdıkça tamamlar)",
  ]},
  { version: "2026.76", date: "2026-08-08", items: [
    "Yeni menü: Tanımlamalar — Gider Grupları + Nakit Akış Verileri buraya taşındı",
    "Gider Grupları sayfası: 6 grup (Ürün/Genel/Personel/Hizmet/Vergi/Bakım) ve alt kalemleri; grup/kalem ekle-düzenle-sil",
  ]},
  { version: "2026.75", date: "2026-08-08", items: [
    "Ana Ekrana Ekle rehberi: iOS'ta 'Paylaş → Ana Ekrana Ekle' anlatımı (WhatsApp içi tarayıcıda 'Safari'de Aç' uyarısı), Android'de tek-dokunuş kurulum",
  ]},
  { version: "2026.74", date: "2026-08-08", items: [
    "Uygulama ikonu yenilendi: logonun altında zarif altın çizgi + serif 'MUHASEBE' yazısı",
  ]},
  { version: "2026.73", date: "2026-08-07", items: [
    "Nakit Akış detayında 'Gelen/Giden Eft' yerine şahıs (eşleşen hesap) adı gösteriliyor",
  ]},
  { version: "2026.72", date: "2026-08-07", items: [
    "POS çekim tarihleri kısa: 12.07.26 (2 haneli yıl); komisyon açıklamasından 'Çekimi' kaldırıldı (ör. '12.07.26 YDK Komisyonu')",
    "Bloke Kontrolü tablosu düzeltildi: tutarlar tek satırda (₺ kaymıyor), sütunlar hizalı",
  ]},
  { version: "2026.71", date: "2026-08-07", items: [
    "POS/bloke kart tipleri kısaltıldı: Kredi Kartı→KK, Debit Kartı→DK, Yurt Dışı Kredi Kartı→YDK (ör. '12.07.26 YDK Çekimi')",
  ]},
  { version: "2026.70", date: "2026-08-07", items: [
    "Nakit Akış: gün aralığı seçimi kaldırıldı, sabit 90 gün",
    "Giren/Çıkan baloncuğu büyükten küçüğe sıralanıyor, tutarların sonunda ₺",
  ]},
  { version: "2026.69", date: "2026-08-07", items: [
    "Nakit Akış sadeleşti: tepedeki öngörülen giriş şeridi, bugünkü bakiye ve tekrarlanan kalemler düğmesi kaldırıldı",
    "Öngörülen (gelecek) satırlar soluk gösteriliyor; günlük giriş ayarı Tekrarlanan Kalemler sayfasına taşındı",
  ]},
  { version: "2026.68", date: "2026-08-07", items: [
    "Nakit Akış: tek hesap görünümü — üstte seçici (Garanti/T.Finans/Nakit), sütunlar Tarih·Giren·Çıkan·Güncel Bakiye, tüm günler",
    "Giren/Çıkan'a dokununca o günkü kalemler açılır; bugünkü bakiye bandı",
  ]},
  { version: "2026.67", date: "2026-08-07", items: [
    "Nakit Akış Raporu yeniden yapıldı: günlük tablo (Garanti/T.Finans/Nakit) — gün sonu bakiyeleri, eksi kırmızı, bloke kolonu",
    "Öngörülen günlük giriş ayarı; bugüne kadar gerçek, sonrası öngörü",
    "Tutara dokun → açıklama + giriş/çıkış (yeşil/kırmızı) canlı çevirme",
    "Tekrarlanan kalemlere Hesap + Rapor kodu; rapor kodlu gerçek hareket öngörünün yerine geçer",
  ]},
  { version: "2026.66", date: "2026-08-07", items: [
    "Banka POS dışı satır yeniden tasarlandı: not simgesi (📝) sağ üstte; özel açıklamayı oradan aç",
    "Şahıs ve (çıkanlarda) Rapor zorunlu — boş alan kırmızı, dolu yeşil; hepsi dolmadan İşle pasif ('N alan eksik')",
  ]},
  { version: "2026.65", date: "2026-08-07", items: [
    "Banka POS dışı: çıkan (ödeme) hareketlerde Rapor artık zorunlu",
    "'+ açıklama' düğmesi: basınca Gelen/Giden Eft yerine özel açıklama yazılabiliyor (geçmişten hatırlanır)",
  ]},
  { version: "2026.64", date: "2026-08-07", items: [
    "Banka POS dışı sadeleşti: açıklama otomatik 'Gelen Eft' / 'Giden Eft'; satırda sadece Hesap (çıkanlarda + Rapor)",
    "Alanlar tek satırda, daha kompakt görünüm",
  ]},
  { version: "2026.63", date: "2026-08-07", items: [
    "Banka POS dışı: eşleşmeyen hesap adı yazılınca yeni hesap (Müşteri/Tedarikçi) olarak eklenip işlenebiliyor",
    "Rapor alanı yalnızca çıkan (ödeme) hareketlerde görünüyor; giren tutarlarda kaldırıldı",
  ]},
  { version: "2026.62", date: "2026-08-07", items: [
    "Banka POS dışı hareketler işlenebiliyor: her satıra hesap adı (zorunlu, yazdıkça tamamlanır), rapor ve açıklama",
    "Benzer açıklamadan otomatik hesap önerisi (geçmişten öğrenir; ilk seferde ada göre tahmin)",
    "Kayıt banka + eşleşen hesaba çift taraflı yazılır; banka açıklaması ve tutar aynen saklanır",
    "Tek 'İşle' düğmesi hem POS çözülmelerini hem eşleştirilen transferleri kaydeder (dekont ile idempotent)",
  ]},
  { version: "2026.61", date: "2026-08-07", items: [
    "Banka: POS dışı hareketler artık ayrı kartta değil, ait olduğu günün bloke çözümlerinin altında, banka kayıt sırasında",
    "Uzun açıklamalar tutarın üstüne binmiyor (taşma düzeltmesi)",
    "Dosya seçme alanı küçültüldü; üstteki bilgi açıklaması kaldırıldı",
  ]},
  { version: "2026.60", date: "2026-08-07", items: [
    "Banka POS artık yatış günü başlıklarıyla, dosyadaki kayıt sırasında gösteriliyor (gün gün, karışık değil)",
    "POS kayıtlarının defter tarihi yatış (kayıt) günü olarak yazılıyor",
  ]},
  { version: "2026.59", date: "2026-08-07", items: [
    "Banka Aktarımı: önce banka seçimi (Garanti / T.Finans / Ziraat)",
    "Garanti POS tahsilatları çekim tarihi + kart tipine (gün farkı 23/16/1: Kredi/Debit/Yurt Dışı) göre gruplanır",
    "POS çözülme muhasebesi: 108 bloke'den çıkış (brüt), 102 banka'ya giriş (brüt) + komisyon çıkışı",
    "Bloke Kontrolü: gün sonu bloke ↔ çözülen tutar karşılaştırması (tutmayan sarı)",
    "Dekont bazlı idempotent (aynı POS grubu iki kez işlenmez)",
  ]},
  { version: "2026.58", date: "2026-08-07", items: [
    "Fatura önizleme yenilendi: segment özet (İşlenecek/Zaten var/Cari yok) — başlığa dokununca süzülür; sade satırlar, kısaltılmış adlar",
    "İşle'ye basınca eksik cariler resmi ünvanla otomatik açılır, sonra işlenir",
    "Cari birleştirme: aynı VKN ya da benzer ad tespiti; onayınla hareketler resmi hesaba taşınır, kopya silinir",
    "Açık/Kapalı sorulurken arka plan bulanıklaşır, altta dolan ilerleme çubuğu; karar verilen satır kısa süre sarıya boyanır",
    "Kasa Kapanış Kontrolü: girilen satır sarı yanıp söner + altta 'kaç/kaç kontrol edildi' çubuğu",
  ]},
  { version: "2026.57", date: "2026-08-07", items: [
    "Fatura türü seçimi yenilendi: net bir soru + iki büyük kart (Satış / Alış); ekrandaki karmaşık açıklamalar kaldırıldı",
  ]},
  { version: "2026.56", date: "2026-08-07", items: [
    "Menü grubu aç/kapa artık çekmece kadar akıcı: yükseklik anlık, hareket tamamen GPU'da (transform+opacity)",
  ]},
  { version: "2026.55", date: "2026-08-07", items: [
    "Dokununca çıkan koyu flaş (iOS tap highlight) kaldırıldı",
    "Sayfa geçişleri daha akıcı: GPU'da yumuşak fade + hafif yukarı kayma",
  ]},
  { version: "2026.54", date: "2026-08-07", items: [
    "Hesap defteri üst kartı yeni 'Altın Banner' tasarımı: emoji + hesap + büyük güncel bakiye",
  ]},
  { version: "2026.53", date: "2026-08-07", items: [
    "Cari kartlarında 'Cari No' gösterilmiyor (alt satır sadece tarih)",
    "Hesap defteri üstünden 'Toplam Giren / Toplam Çıkan' kartları kaldırıldı",
  ]},
  { version: "2026.52", date: "2026-08-07", items: [
    "Açıklamalardaki tarih öneki kaldırıldı (tarih zaten satırda görünüyor) — tüm gün sonu aktarımları",
    "Hareket kartlarında 'No' gösterilmiyor",
  ]},
  { version: "2026.51", date: "2026-08-07", items: [
    "Kasa nakit girişi = sayılan Nakit + gün içi nakit ödemeler (Masraflar) toplamı",
    "Her ödeme (masraf) kasadan Çıkan olarak yazılıyor (net etki = sayılan nakit)",
  ]},
  { version: "2026.50", date: "2026-08-07", items: [
    "Cari onay: aynı tarih+tutar mükerrerleri tek tek işaretlenerek aktarılır (varsayılan: atla)",
    "Mükerrer olmayan cariler her zaman aktarılır; işaretsiz mükerrerler atlanır",
    "Yeniden kaydetmede önceki gün sonu cari hareketleri silinip yenilenir (mükerrer düzelir)",
  ]},
  { version: "2026.49", date: "2026-08-07", items: [
    "Para alanlarında ₺ amblemi düzeltildi (mobilde sayının üstüne biniyordu)",
    "Gün sonu cari kayıtları 120 Müşteri hesaplarına işleniyor: Cari İşlem→Borç, Tahsilat→Alacak",
    "Cari yoksa onay ile otomatik açılıp öyle kaydediliyor (fatura aktarımı gibi)",
    "Aynı tarih ve tutarda kayıt varsa uyarı (gün sonu cari + manuel hareket ekleme)",
  ]},
  { version: "2026.48", date: "2026-08-07", items: [
    "Gün sonu Nakit (Gerçekleşen) 100 Kasa Hesabı'na Giren olarak yazılıyor: açıklama '{tarih} Nakit Girişi'",
  ]},
  { version: "2026.47", date: "2026-08-07", items: [
    "Bloke hareket açıklaması: '{gün sonu tarihi} {isim} Çekimi' (ör. 08.04.2026 Garanti Kredi Kartı Çekimi)",
  ]},
  { version: "2026.46", date: "2026-08-07", items: [
    "(Geçici/test) Kasa Kapanış'a '⚡ Test: Doldur' — tüm Gerçekleşen'i Girilen'den doldurur",
  ]},
  { version: "2026.45", date: "2026-08-07", items: [
    "Menü açılış/kapanışı yüksek FPS: menü kendi GPU katmanında, ağır gölge kaldırıldı",
    "Yükseklik kısa/snappy (0.18s) + içerik compositor'da fade/slide (kasma yok)",
    "Menü satır aralıkları eşitlendi",
  ]},
  { version: "2026.44", date: "2026-08-07", items: [
    "iOS 'Ana Ekrana Ekle' simgesi artık Kübban logosu (apple-touch-icon eklendi)",
    "Ana ekrandan açılışta tam ekran uygulama görünümü + simge adı 'Kübban'",
  ]},
  { version: "2026.43", date: "2026-08-07", items: [
    "Menü aç/kapa kasması giderildi: max-height yerine grid-rows (0fr↔1fr) ile akıcı animasyon",
    "Menü grubunda layout yalıtımı (contain) — açılırken sayfayı zorlamıyor",
    "Dokunmatikte momentum kaydırma + 'hareketi azalt' desteği (genel akıcılık)",
  ]},
  { version: "2026.42", date: "2026-08-07", items: [
    "Yan menü yeni 'Beyaz Kartlar' tasarımı: açık grup altın çerçeveli kutu, seçili sayfa net",
    "Menü sadeleşti: Cari Hareket→Fatura Aktarımı, Banka→Banka Aktarımı",
    "Gün Sonu Aktarımı, Veri Girişleri altına taşındı; Gün Sonu Raporu Raporlar altına",
    "Gün Sonu Kayıtları'na artık Gün Sonu Aktarımı ekranındaki '🕘 Geçmiş Kayıtları Gör' ile ulaşılıyor",
  ]},
  { version: "2026.41", date: "2026-08-07", items: [
    "Gün Sonu Raporu'na 'Sayım Kontrolü' eklendi: Girilen ↔ Gerçekleşen ↔ Fark (renkli, toplam farklı)",
  ]},
  { version: "2026.40", date: "2026-08-07", items: [
    "Blokeye Aktarımlar üstteki cari bölümler gibi kutusuz/düz oldu (tarih dahil)",
    "Menüde Gün Sonu İşlemleri emojisi kasa fişi (🧾) yapıldı",
    "Gün Sonu Raporu yenilendi: gün seç → sade, bol görselli özet (bar/renk/emoji)",
    "Rapordan 📄 PDF indir / WhatsApp'tan paylaş (yazdır → PDF olarak kaydet)",
  ]},
  { version: "2026.39", date: "2026-08-07", items: [
    "Kasa Kapanış: Gerçekleşen alanları kutusuz (düz); başlıklardan ₺ kaldırıldı",
    "GENEL TOPLAM sütunlarla hizalı ve altın renkli",
    "Masraflar: ✕ kaldırıldı, alanlar kutusuz düz metin",
  ]},
  { version: "2026.38", date: "2026-08-07", items: [
    "Adım çubuğu mobilde tek satır: 1–2–3–4 numaralı noktalar, yalnızca aktif adımın adı yazılır",
  ]},
  { version: "2026.37", date: "2026-08-07", items: [
    "Üstteki adım çubuğu mobilde sıra sıra hap düzenine geçti (taşma yok)",
    "Cari İşlemler/Tahsilatlar sadeleşti: kutusuz normal metin, ✕ ve + Satır Ekle kaldırıldı",
    "Girişlerde otomatik yakınlaşma/kayma engellendi (maximum-scale)",
    "Blokeye Aktarımlar tablo oldu (Hesap · Tutar · Valör); tepedeki tarihler kaldırıldı",
    "Garanti Kredi Kartı için iki alan: Tutar ve Komisyon",
    "Masraf adlarında '-' öncesi kısım Rapor koduna ayrıldı; adlar 'İlk Harf Büyük' düzeninde",
    "İçe alınan tüm isimler Başlık Düzeni (TÜMÜ BÜYÜK yerine İlk Harfler Büyük)",
  ]},
  { version: "2026.36", date: "2026-08-07", items: [
    "Alt hesaplar en soldan hizalanıyor (emoji boşluğu kaldırıldı)",
  ]},
  { version: "2026.35", date: "2026-08-07", items: [
    "Kasa Kapanış: kompakt tablo — başlıklar (Girilen/Gerçekleşen/Fark) her grupta bir kez",
    "Masraflar tablo düzenine geçti; açıklamaya dokununca Excel kutusu gibi büyür",
    "Blokeye Aktarımlar: her satır için ayrı valör tarihi (📅); tepedeki tarihler varsayılan kalır",
    "Daha az aşağı kaydırma için satırlar sıkıştırıldı",
  ]},
  { version: "2026.34", date: "2026-08-07", items: [
    "Hesaplar: 'Hesapları Düzenle' artık Hesap Planı kartının sağ üstünde kalem ikonu",
    "Arama yaparken alttaki hesap listesi bulanıklaşır (öneriler öne çıkar)",
  ]},
  { version: "2026.33", date: "2026-08-07", items: [
    "Gün Sonu Aktarım'a 4. adım eklendi: Masraflar (rapordaki 'Masraflar Toplamı' satırları)",
    "Masraflar: 1. sütun ad (sondaki '(Ödenmezler İstihkak)' atılır) · Rapor boş · 3. sütun tutar",
    "Para alanlarındaki ₺ kayması düzeltildi (Cari Kayıtlar ve Bloke tutarları düzgün hizalı)",
    "Hesap aramasındaki öneri listesinden emoji kaldırıldı",
  ]},
  { version: "2026.32", date: "2026-08-07", items: [
    "Hesaplar: üstteki açıklama kutusu kaldırıldı",
    "Emoji yalnızca ana hesaplarda ve üst kartta; alt hesaplardan kaldırıldı",
    "'Tümünü Aç / Kapat' yerine hesap arama: yazınca tahmin eder (ör. 'Ga' → Garanti Bankası)",
    "Aramada Enter'a basınca doğrudan o hesabın hareketlerine gider (↑/↓ ile seçim)",
  ]},
  { version: "2026.31", date: "2026-08-06", items: [
    "Hesaplar ekranı yenilendi: altın 'Genel Toplam' banner'ı ve dekoratif düzen",
    "Her hesaba türüne/markasına göre emoji rozeti (💵 Kasa · 🏦 Banka · 🔒 Bloke · 👥 Alıcı · 🚚 Tedarikçi · 🍽️🛵🛒 platformlar)",
  ]},
  { version: "2026.30", date: "2026-08-06", items: [
    "Gün Sonu Aktarım'a 3. adım eklendi: Cari Kayıtlar",
    "Bölüm 1 – Cari İşlemler: rapordaki 'Kredili Satışlar' şahıs satırları (düzenlenebilir liste)",
    "Bölüm 2 – Cari Tahsilatlar: rapordaki 'Tahsilatlar' şahıs satırları (düzenlenebilir liste)",
    "Bölüm 3 – Blokeye Aktarımlar: kasa 'Gerçekleşen' tutarları 108 bloke hesaplarına Borç yazılır",
    "Garanti: Kredi Kartı ve Debit Kartı elle; Yurt Dışı otomatik (Gerçekleşen − Kredi − Debit)",
    "108 bloke hesapları eklendi: Edenred, Multinet, Pluxee, Metropol, Set Kurumsal",
    "108 hesap defterleri artık Borç/Alacak sütunlarıyla (cari düzen) gösteriliyor",
    "İşlem/Valör tarihi düzenlenebilir (varsayılan gün sonu +1)",
  ]},
  { version: "2026.29", date: "2026-08-04", items: [
    "Kasa Kapanış tepe özeti tek sütun, satır satır: Tarih · Brüt Satış · İskonto · İkram · X · Net Satış",
  ]},
  { version: "2026.28", date: "2026-08-04", items: [
    "Kasa Kapanış: tepede Brüt Satış · İskonto · İkram · X · Net Satış (rapordan, salt-okunur)",
    "X ödeme yöntemlerinden çıkarıldı; X yazınca İkram'dan otomatik düşer, Net Satış güncellenir",
    "3 sütun (Sistem/Gerçekleşen/Fark) aynı hizada gösteriliyor",
    "Türkçe I/İ eşleştirme hatası düzeltildi (İskonto/İkram doğru okunuyor)",
  ]},
  { version: "2026.27", date: "2026-08-04", items: [
    "Kasa Kapanış Kontrolü mobil-dostu, gruplu düzene geçti (tablo taşması giderildi)",
    "Gruplar: Banka ve Nakit · Yemek Platformları · Yemek Kartları (grup + genel toplam/fark)",
  ]},
  { version: "2026.26", date: "2026-08-04", items: [
    "Gün Sonu Aktarım çok adımlı yapıldı: tepede ilerleme çubuğu, geri/ileri",
    "Adım 1 – Kasa Kapanış Kontrolü: rapordaki Kasa Sayımları tablosu alınır",
    "Sabit ödeme yöntemleri (X, Nakit, Garanti, Sanal, T.Finans, QR, Havale, Yemek Sepeti, Getir, Trendyol(+E-Ticaret), kart'lar) — rapor içermese de satır durur",
    "Sütunlar: Ödeme Yöntemi · Sisteme Girilen (rapordan) · Gerçekleşen (elle) · Fark; en başta tarih",
    "Kayıt Gün Sonu Kayıtları'na yazılır ve oradan yeniden düzenlenebilir",
  ]},
  { version: "2026.25", date: "2026-08-04", items: [
    "108 Blokeli Hesaplar altına 5 sabit alt hesap eklendi (Garanti/Türkiye Finans bloke, Yemek Sepeti, Getir Yemek, Trendyol)",
    "Hesapları Düzenle modunda 'Varsayılanları Tamamla': eksik varsayılan hesapları veri kaybı olmadan ekler",
  ]},
  { version: "2026.24", date: "2026-08-04", items: [
    "Cari aktarımda açıklamalar kaldırıldı, Excel yükleme alanı küçültüldü",
    "Aktarımda faturalar sıra sıra soruluyor: Açık / Kapalı / Kısmi Kapat (Kısmi'de tutar girilir)",
    "Kısmi kapatta girilen tutar karşı tarafa (Alacak/Borç) yazılır",
    "Önizleme mobilde kart, masaüstünde tablo; satıra/karta dokununca durumu yeniden sorar",
  ]},
  { version: "2026.23", date: "2026-08-04", items: [
    "Cari defter üst kartları sadeleşti: Hesap adı + Güncel Bakiye",
    "Hesaplar: satırlardaki ✎/＋ kaldırıldı; üstte 'Hesapları Düzenle' modu geldi",
    "Hesap kodu küçültüldü; asıl vurgu hesap adı ve güncel bakiye",
    "Satış faturası önizlemesinde satır satır Açık/Kapalı; Kapalı ise tutar Alacağa da yazılır",
  ]},
  { version: "2026.22", date: "2026-08-04", items: [
    "İçe aktarılan faturalarda Açıklama artık 'Fatura' yazıyor",
    "Aktarımdan sonra inceleme turu: işlenen carilere tek tek gidilir",
    "'‹Cari› bakıldı, bir sonrakine bakılsın mı?' — Enter ile sonrakine geçilir",
  ]},
  { version: "2026.21", date: "2026-08-04", items: [
    "Excel okuma düzeltildi (raw): tutarlar artık doğru (Amerikan/Türkçe format karışıklığı giderildi)",
    "Fatura önizleme: Başlama/Bitiş/Süre/Belge Sayısı gibi özet satırları elenir",
    "Hesaplarda güncel bakiye artık borç/alacak hareketlerini de içeriyor (cari bakiyeler görünür)",
    "VKN baştaki sıfırlarıyla korunuyor",
  ]},
  { version: "2026.20", date: "2026-08-04", items: [
    "Cari Hareket İşleme: Fatura Genel Raporu Excel'i (Fatura No/Tarih/Cari Adı/VKN/Ödenecek Miktar)",
    "Yüklerken Alış mı Satış mı sorulur; Alış→320 Alacak, Satış→120 Borç",
    "Önizleme: her fatura cari hesapla eşleştirilir; cari yoksa oradan '+ Cari Ekle' (alt hesap açar)",
    "Aynı caride aynı fatura no varsa aktarılmaz (mükerrer atlanır); İşlem No/Cari No otomatik",
  ]},
  { version: "2026.19", date: "2026-08-04", items: [
    "Mobil pencereler alttan açılmıyor; üstten normal sayfa gibi kaydırılıyor (klavye alanları/butonları kapatmıyor)",
  ]},
  { version: "2026.18", date: "2026-08-04", items: [
    "Tarih ve diğer alanların taşması giderildi (ızgara hücreleri küçülebiliyor)",
    "Giren/Çıkan ve Borç/Alacak tutarları para birimi biçiminde (binlik ayraç + ₺)",
    "Değişiklik Kaydı eklendi (Sistem): kim, ne zaman, neyi ekledi/düzenledi/sildi",
  ]},
  { version: "2026.17", date: "2026-08-04", items: [
    "Mobil pencereler (Yeni Hareket vb.) alttan açılan sayfa (bottom-sheet) oldu",
    "Kaydet/Vazgeç butonları altta sabit ve hep görünür; başlık üstte sabit",
    "İkili alanlar yan yana kaldı (form kısaldı); alanlar sıkılaştırıldı, iOS'ta odakta yakınlaşma engellendi",
  ]},
  { version: "2026.16", date: "2026-08-04", items: [
    "Hesap defteri mobilde banka uygulaması tarzı hareket kartlarına dönüşüyor (tablo taşmıyor)",
    "Kartta: açıklama/şahıs, tarih+no, tutar (yeşil giriş / kırmızı çıkış), altında bakiye",
    "Masaüstünde tam tablo korunuyor; karta dokununca düzenleme açılıyor",
  ]},
  { version: "2026.15", date: "2026-08-04", items: [
    "Mobil: özet kartları 2x2 kompakt ızgara, daha küçük yazı/boşluk (daha az yer kaplıyor)",
  ]},
  { version: "2026.14", date: "2026-08-04", items: [
    "Alt hesaplar ana hesaplarla aynı hizada (fazla girinti kaldırıldı); soldaki altın çizgi ile ayrışıyor",
  ]},
  { version: "2026.13", date: "2026-08-04", items: [
    "Hesap listesi sağ tarafı hizalandı: bakiye ve [＋][✎][›] ikonları sabit sütunlarda",
    "Alt hesap girintisi solda korunuyor (alt hesap olduğu belli), sağ taraf kaymıyor",
  ]},
  { version: "2026.12", date: "2026-08-04", items: [
    "Hesap listesi renkleri düzeltildi: alt hesaplar beyaz + soldan altın rehber çizgisi",
    "Açık ana hesap hafif altın vurguyla grup başlığı gibi görünüyor",
  ]},
  { version: "2026.11", date: "2026-08-04", items: [
    "Hesap Planı tablo yerine şık liste görünümüne geçti (mobilde çok daha düzenli)",
    "Kod + ad tek satır, sağda bakiye; düzenle ✎ ve alt hesap ＋ ikonları",
    "Hesaba dokununca hareket defteri açılır (yaprak/alt), ana hesap açılıp kapanır",
  ]},
  { version: "2026.10", date: "2026-08-04", items: [
    "Mobil arayüz: hamburger menü (☰) ve kayan yan menü (drawer) + arka plan karartma",
    "Menüden bir sayfa seçince menü otomatik kapanıyor",
    "Kartlar, formlar ve tablolar mobile göre düzenlendi; tablolar kutu içinde kayıyor",
    "Dokunmatik için daha büyük butonlar",
  ]},
  { version: "2026.09", date: "2026-08-04", items: [
    "Hesaplar: alt hesaplar artık KAPALI (dar) başlıyor, isteğe göre açılır",
    "Sayfa geçişi yalnızca yumuşak solma; yatay kayma/genişleme kaldırıldı",
  ]},
  { version: "2026.08", date: "2026-08-04", items: [
    "Cari hesaplar (320 Tedarikçi / 120 Müşteri) için ayrı hareket defteri",
    "Cari kolonları: İşlem No · Cari No · Tarih · Şahıs · Açıklama · Borç · Alacak · Güncel Bakiye · Fatura Türü · Fatura No",
    "Cari No hesap bazında sıralı (kaçıncı kayıt); İşlem No global",
    "Güncel bakiye Borç − Alacak ile yürüyor; Borç/Alacak bakiye göstergesi",
  ]},
  { version: "2026.07", date: "2026-08-04", items: [
    "Hesap iç yapısı: hesaba tıklayınca Hareket Defteri açılıyor (Kasa dahil tüm hesaplar)",
    "Hareket kolonları: İşlem No · Tarih · İşlem Adı · Şahıs · Açıklama · Rapor · Giren · Çıkan · Güncel Bakiye",
    "İşlem No otomatik ve sıralı (kaydın kimlik numarası)",
    "Her satırda yürüyen (güncel) bakiye; hesap bakiyesi hareketlere göre güncelleniyor",
  ]},
  { version: "2026.06", date: "2026-08-04", items: [
    "Hesaplar: hesap açılıp kapanınca tablo yatay kaymıyor (sabit sütun düzeni)",
    "Hesaplar: Sil butonu artık Düzenle penceresinin içinde",
    "Yeni Hesap: önce Ana/Alt seçimi; Alt seçilirse üst (ana) hesabı seçtiriyor",
  ]},
  { version: "2026.05", date: "2026-08-04", items: [
    "Güncelleme ekranına 'Uygulamayı Güncelle' butonu eklendi (Ctrl+F5 gerekmez)",
    "Dosyalara sürüm etiketi (?v) eklendi; yeni sürümler önbelleğe takılmadan yüklenir",
    "Hesaplar: Tür sütunu kaldırıldı; alt hesaplar akordeon (satıra tıkla aç/kapat)",
    "Hesaplar: alt hesap kodu otomatik ilerliyor (ör. 102.03 sonrası 102.04)",
  ]},
  { version: "2026.04", date: "2026-08-04", items: [
    "Hesaplar: ana hesap → alt hesap (hiyerarşik hesap planı) yapısı geldi",
    "Alt hesap ekleme (ör. 102 Banka altına Garanti/Türkiye Finans/Ziraat)",
    "Ana hesap bakiyesi alt hesaplarının toplamı olarak gösteriliyor (aç/kapat ağaç)",
    "Tek tıkla varsayılan hesap planı oluşturma (100/102/108/120/320)",
    "Banka İşleme'de hedef hesap listesi yaprak banka hesaplarını gösteriyor",
  ]},
  { version: "2026.03", date: "2026-08-04", items: [
    "Performans: sayfa geçişleri anlık ve akıcı hale getirildi (yükleniyor titremesi kaldırıldı, yumuşak geçiş eklendi)",
    "İçe aktarma tablolarında yazarken toplam hesaplama akıcılaştırıldı (rAF ile kısıtlama)",
    "Akordeon menü açılışı daha hızlı",
  ]},
  { version: "2026.02", date: "2026-08-04", items: [
    "Sol menü akordeon yapıldı (ana bölümler açılır-kapanır) ve yeniden sıralandı",
    "Üst markaya 'Güllüoğlu Kübban' yazıldı",
    "Sistem altına Güncelleme / Sürüm ekranı eklendi",
    "GitHub Pages üzerinden canlı yayına alındı",
  ]},
];

// Akordeon menü: ana bölümler + alt sayfalar. Sıra kullanıcı isteğine göre.
const NAV = [
  { label: "Dashboard", icon: "📊", path: "dashboard" },
  { label: "Veri Girişleri", icon: "📝", children: [
    { label: "Fatura Aktarımı",   icon: "🧾", path: "cari-hareket" },
    { label: "Banka Aktarımı",    icon: "🏦", path: "banka" },
    { label: "Gün Sonu Aktarımı", icon: "🌙", path: "gunsonu-aktarim" },
  ]},
  { label: "Hesaplar", icon: "💼", path: "hesaplar" },
  { label: "Raporlar", icon: "📈", children: [
    { label: "Kâr / Zarar Durumu",  icon: "💹", path: "kar-zarar" },
    { label: "Nakit Akış Raporu",   icon: "📈", path: "nakit-akis-rapor" },
    { label: "Gün Sonu Raporu",     icon: "📄", path: "gunsonu-rapor" },
  ]},
  { label: "Sistem", icon: "⚙️", children: [
    { label: "Kullanıcılar",        icon: "👥", path: "kullanicilar", admin: true },
    { label: "Gider Grupları",      icon: "🧾", path: "gider-gruplari" },
    { label: "Nakit Akış Verileri", icon: "🔄", path: "nakit-akis-veri" },
    { label: "Değişiklik Kaydı", icon: "📋", path: "audit" },
    { label: "Yedek / Veri", icon: "💾", path: "yedek" },
    { label: "Güncelleme",   icon: "🆕", path: "guncelleme" },
  ]},
];

const ROUTES = {
  "dashboard":        { title: "Dashboard", crumb: "Ana Sayfa", render: viewDashboard },
  "gunsonu-aktarim":  { title: "Gün Sonu Aktarımı", crumb: "Veri Girişleri", render: viewGunSonuAktarim },
  "gunsonu-kayitlar": { title: "Gün Sonu Kayıtları", crumb: "Gün Sonu Aktarımı", render: viewGunSonuKayitlar },
  "gunsonu-rapor":    { title: "Gün Sonu Raporu", crumb: "Raporlar", render: viewGunSonuRapor },
  "hesaplar":         { title: "Hesaplar", crumb: "Hesaplar", render: viewHesaplar },
  "cari-import":      { title: "Toplu Cari İçe Aktar", crumb: "Hesaplar", render: viewCariImport },
  "kasa-import":      { title: "Kasa Geçmişi İçe Aktar", crumb: "Hesaplar", render: viewKasaImport, admin: true, back: "#/hesaplar" },
  "banka-import":     { title: "Banka Geçmişi İçe Aktar", crumb: "Hesaplar", render: viewBankaImport, admin: true, back: "#/hesaplar" },
  "cari-gecmis-import": { title: "Cari Geçmişi İçe Aktar", crumb: "Hesaplar", render: viewCariGecmisImport, admin: true, back: "#/hesaplar" },
  "hesap-detay":      { title: "Hesap Hareketleri", crumb: "Hesaplar", render: viewAccountLedger, back: "#/hesaplar" },
  "cari-hareket":     { title: "Fatura Aktarımı", crumb: "Veri Girişleri", render: viewCariHareket },
  "banka":            { title: "Banka Aktarımı", crumb: "Veri Girişleri", render: viewBanka },
  "kar-zarar":        { title: "Kâr / Zarar Durumu", crumb: "Raporlar", render: viewKarZarar },
  "nakit-akis-rapor": { title: "Nakit Akış Raporu", crumb: "Raporlar", render: viewNakitAkisRapor },
  "nakit-akis-veri":  { title: "Nakit Akış Verileri", crumb: "Sistem", render: viewNakitAkisVeri },
  "gider-gruplari":   { title: "Gider Grupları", crumb: "Sistem", render: viewGiderGruplari },
  "yedek":            { title: "Yedek / Veri", crumb: "Sistem", render: viewYedek },
  "guncelleme":       { title: "Güncelleme", crumb: "Sistem", render: viewGuncelleme },
  "audit":            { title: "Değişiklik Kaydı", crumb: "Sistem", render: viewAuditLog },
  "kullanicilar":     { title: "Kullanıcılar", crumb: "Sistem", render: viewUsers, admin: true },
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
      const inner = document.createElement("div");
      inner.className = "nav-group-inner";
      n.children.forEach((ch) => {
        if (ch.admin && !isAdmin()) return;   // yönetici sayfaları sadece yöneticide
        const a = document.createElement("a");
        a.className = "nav-item nav-sub";
        a.href = "#/" + ch.path;
        a.dataset.path = ch.path;
        a.innerHTML = `<span class="ico">${ch.icon}</span><span>${esc(ch.label)}</span>`;
        inner.appendChild(a);
      });
      bodyEl.appendChild(inner);

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

async function route(opts = {}) {
  const silent = opts === true || opts?.silent;   // sessiz tazeleme: göstergesiz, animasyonsuz
  const path = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
  const r = ROUTES[path] || ROUTES["dashboard"];
  closeDrawer(); // mobilde gezinince menüyü kapat
  if (reviewKeyHandler) { document.removeEventListener("keydown", reviewKeyHandler); reviewKeyHandler = null; }
  if (ledgerFitHandler) { window.removeEventListener("resize", ledgerFitHandler); ledgerFitHandler = null; }
  const navPath = path === "hesap-detay" ? "hesaplar"
    : path === "gunsonu-kayitlar" ? "gunsonu-aktarim" : path;
  $$("#nav .nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.path === navPath));
  // Aktif sayfanın bulunduğu grubu aç (akordeon)
  $$("#nav .nav-group").forEach((g) =>
    g.classList.toggle("open", Array.isArray(g._paths) && g._paths.includes(navPath)));
  $("#page-title").textContent = r.title;
  $("#crumb").textContent = r.crumb;
  const backEl = $("#page-back");
  if (backEl) {
    if (r.back) { backEl.style.display = ""; backEl.onclick = () => { location.hash = r.back; }; }
    else { backEl.style.display = "none"; backEl.onclick = null; }
  }
  const c = $("#view-container");
  // İlk yükleme yavaşsa (önbellek yoksa) üstte ince ilerleme çubuğu göster.
  // Önbellekten anında gelen geçişlerde (<140ms) hiç görünmez → titremez.
  const barTimer = silent ? null : setTimeout(showRouteBar, 140);
  try {
    await r.render(c);
    if (!silent) {
      // Yumuşak geçiş (GPU: opacity + transform)
      c.style.animation = "none";
      void c.offsetWidth;
      c.style.animation = "viewIn .22s cubic-bezier(.22,.61,.36,1)";
    }
  } catch (err) {
    console.error(err);
    c.innerHTML = `<div class="notice warn"><b>Hata:</b> ${esc(err.message || err)}</div>`;
  } finally {
    if (barTimer) clearTimeout(barTimer);
    if (!silent) hideRouteBar();
  }
}

// Üst ilerleme çubuğu (sayfa yüklenirken) --------------------------------
function showRouteBar() {
  let bar = document.getElementById("route-bar");
  if (!bar) { bar = document.createElement("div"); bar.id = "route-bar"; document.body.appendChild(bar); }
  bar.classList.remove("done");
  bar.style.width = "0%";
  void bar.offsetWidth;
  bar.classList.add("on");
  bar.style.width = "82%";           // trickle
}
function hideRouteBar() {
  const bar = document.getElementById("route-bar");
  if (!bar) return;
  bar.style.width = "100%";
  setTimeout(() => { bar.classList.remove("on"); bar.style.width = "0%"; }, 220);
}

// Arka plan tazelemesi veri değiştirdiğinde: mevcut sayfayı SESSİZCE yeniden çiz.
// Defterde/pencerede/yazarken dokunma (yerel durum/odak kaybolmasın).
let _silentTimer = null;
function scheduleSilentRefresh() {
  clearTimeout(_silentTimer);
  _silentTimer = setTimeout(() => {
    const path = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
    if (path === "hesap-detay") return;                        // defterde yerel durum var
    if ($("#modal-root")?.children.length) return;             // pencere açık
    const ae = document.activeElement;
    if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return; // kullanıcı yazıyor
    route({ silent: true });
  }, 250);
}
if (typeof setRevalidateHandler === "function") setRevalidateHandler(scheduleSilentRefresh);
// requestAnimationFrame ile kısıtlama (akıcı yeniden hesaplama için)
function rafThrottle(fn) {
  let scheduled = false;
  return (...a) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; fn(...a); });
  };
}
window.addEventListener("hashchange", () => route());

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
  // raw:true → sayılar gerçek sayı olarak gelir (yerel format karışıklığı olmaz),
  // metin hücreleri (ör. VKN baştaki sıfırlarıyla) string kalır.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  // Başlık satırını AKILLICA bul: en çok "başlık kelimesi" içeren satır.
  // (Dosyanın tepesinde başlık bandı / yanda menü metni olsa bile şaşmaz.)
  const HK = ["cari", "unvan", "bakiye", "tur", "tarih", "borc", "alacak", "tutar",
    "hesap", "sahis", "aciklama", "fatura", "rapor", "kod", "giren", "cikan", "banka", "adi"];
  const hscore = (r) => (r || []).map((c) => normTr(c)).filter(Boolean)
    .reduce((s, c) => s + (HK.some((k) => c.includes(k)) ? 1 : 0), 0);
  let headerIdx = -1, best = 1;
  aoa.slice(0, 25).forEach((r, i) => { const sc = hscore(r); if (sc > best) { best = sc; headerIdx = i; } });
  if (headerIdx < 0) headerIdx = aoa.findIndex((r) => r.filter((c) => String(c).trim() !== "").length >= 2);
  if (headerIdx < 0) headerIdx = aoa.findIndex((r) => r.some((c) => String(c).trim() !== ""));
  if (headerIdx < 0) return { headers: [], rows: [] };
  const pad = (n) => String(n).padStart(2, "0");
  const clean = (v) => (v instanceof Date)
    ? `${pad(v.getUTCDate())}.${pad(v.getUTCMonth() + 1)}.${v.getUTCFullYear()}`
    : v;
  const headers = aoa[headerIdx].map((h, i) => String(h).trim() || `Sütun ${i + 1}`);
  const rows = aoa.slice(headerIdx + 1)
    .filter((r) => r.some((c) => String(c).trim() !== ""))
    .map((r) => headers.reduce((o, h, i) => ((o[h] = clean(r[i] ?? "")), o), {}));
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
function fileDrop(onFile, accept = ".xlsx,.xls,.csv", compact = false) {
  const wrap = document.createElement("div");
  wrap.className = "filedrop" + (compact ? " sm" : "");
  wrap.innerHTML = compact
    ? `<div><b>📄 Dosya seç</b> ya da sürükle <span style="color:var(--ink-faint);font-size:11px">(.xlsx / .xls / .csv)</span></div>
       <input type="file" accept="${accept}" style="display:none" />`
    : `<div class="ico">📄</div>
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
  const [accounts, records, cashflow, cari, bank, entries] = await Promise.all([
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.dayEndRecords).catch(() => []),
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
    fetchAll(C.accountEntries).catch(() => []),
  ]);
  const bal = computeBalances(accounts, cari, bank, entries);
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
          : `<div class="empty"><div class="ico">🗓️</div><p>Bugün için gün sonu kaydı yok.</p><a class="btn btn-primary btn-sm" href="#/gunsonu-aktarim">Gün Sonu Aktarımı</a></div>`}
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
// ---- Kasa Sayımları: sabit ödeme yöntemleri (istenen sıra) ----
const GS_PAY_METHODS = [
  { key: "Nakit",              alias: ["nakit"] },
  { key: "Garanti Bankası",    alias: ["garanti bbva", "garanti banka", "garanti bankası"] },
  { key: "Garanti Sanal",      alias: ["sanal pos", "garanti sanal"] },
  { key: "T.Finans Banka",     alias: ["turkiye finans", "türkiye finans", "t.finans banka", "t.finans bankası"] },
  { key: "T.Finans Qr",        alias: ["t.finans qr", "finans qr", "tfinans qr"] },
  { key: "Havale",             alias: ["havale"] },
  { key: "Yemek Sepeti",       alias: ["y.sepeti", "yemek sepeti", "yemeksepeti"] },
  { key: "Getir Yemek",        alias: ["getir"] },
  { key: "Trendyol",           alias: ["trendyol online", "trendyol"] },
  { key: "Trendyol E-Ticaret", alias: ["trendyol e-ticaret", "trendyol eticaret", "e-ticaret", "eticaret"] },
  { key: "Metropol Card",      alias: ["metropol"] },
  { key: "Ticket",             alias: ["ticket"] },
  { key: "Multinet",           alias: ["multinet"] },
  { key: "Sodexho",            alias: ["sodexho", "sodexo"] },
  { key: "Set Kurumsal",       alias: ["set kurumsal"] },
];
// Ödeme yöntemi grupları (sıra korunur)
const GS_GROUPS = [
  { name: "Banka ve Nakit", methods: ["Nakit", "Garanti Bankası", "Garanti Sanal", "T.Finans Banka", "T.Finans Qr", "Havale"] },
  { name: "Yemek Platformları", methods: ["Yemek Sepeti", "Getir Yemek", "Trendyol", "Trendyol E-Ticaret"] },
  { name: "Yemek Kartları", methods: ["Metropol Card", "Ticket", "Multinet", "Sodexho", "Set Kurumsal"] },
];
// Türkçe karakterleri ASCII'ye katlayarak normalize (I/İ/ı → i vb.) — eşleştirme için
const normTr = (s) => String(s || "")
  .replace(/[İIı]/g, "i").replace(/[Şş]/g, "s").replace(/[Çç]/g, "c")
  .replace(/[Ğğ]/g, "g").replace(/[Öö]/g, "o").replace(/[Üü]/g, "u")
  .replace(/[̀-ͯ]/g, "")   // birleşen aksanları sil (ör. "İ".toLowerCase() → "i"+U+0307)
  .toLowerCase().replace(/\s+/g, " ").trim();
// Başlık düzeni: TÜMÜ BÜYÜK olsa bile "İlk Harfler Büyük" (kelime başları), gerisi küçük
function titleCase(s) {
  // Not: "İ".toLowerCase() → "i"+U+0307 (görünmez nokta) üretir; onu temizle
  return String(s || "").toLowerCase().replace(/[̀-ͯ]/g, "")
    .replace(/(^|[\s\-.\/(&])([a-zçğıöşü])/g, (m, sep, ch) => sep + ch.toUpperCase());
}
function gsMatchMethod(label) {
  const lab = normTr(label);
  let best = null, bestLen = 0;
  for (const m of GS_PAY_METHODS) for (const al of m.alias) {
    const a = normTr(al);
    const hit = a.length <= 1 ? lab === a : (lab === a || lab.includes(a));
    if (hit && a.length > bestLen) { best = m.key; bestLen = a.length; }
  }
  return best;
}
async function parseSheetAOA(file) {
  const XLSX = await loadXLSX();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "", raw: true });
}
// Ayraçla ayrılmış metni (CSV) AOA'ya çevirir — tırnaklı alanları, gömülü ayraç/satırsonunu ve
// BOM'u işler. Ayraç ilk dolu satırdan sezilir (';' baskınsa ';', değilse ',').
function parseDSV(text) {
  text = String(text || "");
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") || "";
  const delim = firstLine.split(";").length >= firstLine.split(",").length ? ";" : ",";
  const rows = []; let cur = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || cur.length) { cur.push(field); rows.push(cur); }
  return rows;
}
// Düzeltme/eşleştirme dosyası: .csv ise parseDSV, aksi halde Excel okuyucu.
async function parseTableAOA(file) {
  if (/\.csv$/i.test(file.name || "")) return parseDSV(await file.text());
  return parseSheetAOA(file);
}
function gsExtractDate(aoa) {
  for (const r of aoa.slice(0, 8)) for (const c of r) {
    const m = String(c || "").match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return todayISO();
}
function gsExtractKasa(aoa) {
  const idx = aoa.findIndex((r) => normTr(r[0]).includes("kasa sayimlari"));
  const values = {};
  if (idx >= 0) for (let i = idx + 1; i < aoa.length; i++) {
    const raw0 = String(aoa[i][0] || "").trim();
    if (!raw0 || /^[=_-]{3,}/.test(raw0)) break;
    const label = raw0.replace(/^-+>?\s*/, "").trim();
    if (/^toplam/i.test(label)) break;
    const key = gsMatchMethod(label);
    if (key) values[key] = (values[key] || 0) + parseNum(aoa[i][1]);
  }
  return GS_PAY_METHODS.map((m) => ({ yontem: m.key, sistem: values[m.key] || 0, gerceklesen: "" }));
}
// Raporun tepesindeki özet: Brüt Satış, İskonto, İkram
function gsExtractTotals(aoa) {
  const find = (kw) => aoa.find((r) => normTr(r[0]).includes(kw));
  const num = (r, prefCol) => {
    if (!r) return 0;
    if (prefCol != null && parseNum(r[prefCol])) return parseNum(r[prefCol]);
    for (let c = r.length - 1; c >= 1; c--) { const v = parseNum(r[c]); if (v) return v; }
    return 0;
  };
  return {
    brut: num(find("brut satis"), 3),
    iskonto: num(find("iskonto"), 2),
    ikram: num(find("ikram"), 2),
  };
}
// Bir satırdaki tutarı bul: önce tercih edilen sütun, yoksa son dolu sayısal hücre
const gsRowAmount = (r, prefCol) => {
  const p = parseNum(r[prefCol]); if (p) return p;
  for (let c = r.length - 1; c >= 1; c--) { const v = parseNum(r[c]); if (v) return v; }
  return 0;
};
// Bir başlıktan "------" ayracına kadar olan şahıs satırlarını çıkarır.
//   marker  : başlık anahtar kelimesi (normTr ile eşleşir)
//   amtCol  : tutarın bulunduğu sütun indeksi (yoksa son dolu sayısal alınır)
//   skipArrow: "-> Nakit" gibi özet satırlarını atla
function gsExtractSection(aoa, marker, amtCol, skipArrow) {
  const idx = aoa.findIndex((r) => normTr(r[0]).includes(marker));
  const out = [];
  if (idx < 0) return out;
  for (let i = idx + 1; i < aoa.length; i++) {
    const raw = String(aoa[i][0] || "").trim();
    if (!raw) continue;
    if (/^[=_-]{3,}/.test(raw)) break;          // ayraç → bölüm bitti
    if (skipArrow && /^-+>/.test(raw)) continue; // "-> Nakit" özet satırı
    const sahis = raw.replace(/\s*\([^)]*\)\s*$/, "").trim(); // sondaki (…) etiketi atılır
    const tutar = gsRowAmount(aoa[i], amtCol);
    if (!sahis || !tutar) continue;
    out.push({ sahis, tutar });
  }
  return out;
}
// Bölüm 1 – Cari İşlemler ("Kredili Satislar Toplami (-)", tutar 3. sütun)
const gsExtractCariIslem = (aoa) => gsExtractSection(aoa, "kredili satis", 2, false)
  .map((r) => ({ ...r, sahis: titleCase(r.sahis) }));
// Bölüm 2 – Cari Tahsilatlar ("Tahsilatlar Toplami (+)", tutar 2. sütun, özet satırları atla)
const gsExtractCariTahsilat = (aoa) => gsExtractSection(aoa, "tahsilatlar toplami", 1, true)
  .map((r) => ({ ...r, sahis: titleCase(r.sahis) }));

// Adım 4 – Masraflar ("Masraflar Toplami (-)"): 1. sütun ad (sondaki (Ödenmezler İstihkak)
// eki atılır), 2. sütun Rapor (boş), 3. sütun (indeks 2) çıkan tutar.
function gsExtractMasraflar(aoa) {
  const idx = aoa.findIndex((r) => normTr(r[0]).includes("masraflar toplami"));
  const out = [];
  if (idx < 0) return out;
  for (let i = idx + 1; i < aoa.length; i++) {
    const raw = String(aoa[i][0] || "").trim();
    if (!raw) continue;
    if (/^[=_-]{3,}/.test(raw)) break;                 // ayraç → bölüm bitti
    const full = raw.replace(/\s*\([^)]*\)?\s*$/, "").trim(); // sondaki (…) etiketi (kapanışsız da olsa) atılır
    // "-"den önceki kısım rapor kodu, sonraki kısım açıklama
    const dash = full.indexOf("-");
    const rapor = dash > 0 ? titleCase(full.slice(0, dash).trim()) : "";
    const ad = titleCase(dash > 0 ? full.slice(dash + 1).trim() : full);
    const tutar = gsRowAmount(aoa[i], 2);
    if (!ad || !tutar) continue;
    out.push({ ad, rapor, tutar });
  }
  return out;
}

// Bölüm 3 – Blokeye Aktarım eşleştirmesi (ödeme yöntemi → 108 bloke hesabı)
const GS_BLOKE_MAP = [
  { method: "Garanti Bankası", code: "108.01", garanti: true },
  { method: "T.Finans Banka",  code: "108.02" },
  { method: "Yemek Sepeti",    code: "108.03" },
  { method: "Getir Yemek",     code: "108.04" },
  { method: "Trendyol",        code: "108.05" },
  { method: "Ticket",          code: "108.06" }, // Edenred
  { method: "Multinet",        code: "108.07" }, // Multinet
  { method: "Sodexho",         code: "108.08" }, // Pluxee
  { method: "Metropol Card",   code: "108.09" }, // Metropol
  { method: "Set Kurumsal",    code: "108.10" }, // Set Kurumsal
];
// Kasa "Gerçekleşen" tutarlarından bloke satırlarını üretir.
//   Garanti → Kredi Kartı (elle) · Debit Kartı (elle) · Yurt Dışı (otomatik)
//   Diğerleri → tek satır (Gerçekleşen tutar)
function gsComputeBlokeRows(state, codeToName) {
  const bl = state.bloke || {};
  const gerMap = {};
  (state.kasa || []).forEach((r) => {
    gerMap[r.yontem] = (r.gerceklesen === "" || r.gerceklesen == null) ? 0 : parseNum(r.gerceklesen);
  });
  const out = [];
  for (const m of GS_BLOKE_MAP) {
    const ger = gerMap[m.method] || 0;
    const name = (codeToName && codeToName[m.code]) || m.method;
    if (m.garanti) {
      const kredi = parseNum(bl.garantiKredi), debit = parseNum(bl.garantiDebit);
      out.push({ code: m.code, name, aciklama: "KK", tip: "kredi", manual: true, borc: kredi, ger });
      out.push({ code: m.code, name, aciklama: "DK", tip: "debit", manual: true, borc: debit, ger });
      out.push({ code: m.code, name, aciklama: "YDK", tip: "yurtdisi", manual: false, borc: ger - kredi - debit, ger });
    } else {
      out.push({ code: m.code, name, aciklama: "", tip: "tek", manual: false, borc: ger, ger });
    }
  }
  return out;
}

// 108 altında yeni eklenen bloke hesapları (yemek kartları)
const GS_BLOKE_EXTRA = [
  { code: "108.06", name: "Edenred" },
  { code: "108.07", name: "Multinet" },
  { code: "108.08", name: "Pluxee" },
  { code: "108.09", name: "Metropol" },
  { code: "108.10", name: "Set Kurumsal" },
];
// Eksik 108 bloke alt hesaplarını tamamla (mevcutları korur)
async function ensureBlokeAccounts() {
  const accounts = await fetchAll(C.accounts).catch(() => []);
  const byCode = new Map(accounts.map((a) => [String(a.code), a]));
  let parent = byCode.get("108");
  if (!parent) {
    const ref = await addDoc(C.accounts(), {
      code: "108", name: "Blokeli Hesaplar", type: "diger",
      parentId: null, parentCode: null, openingBalance: 0, createdAt: serverTimestamp(),
    });
    parent = { id: ref.id, code: "108" }; byCode.set("108", parent);
  }
  for (const s of GS_BLOKE_EXTRA) {
    if (byCode.has(s.code)) continue;
    const ref = await addDoc(C.accounts(), {
      code: s.code, name: s.name, type: "diger",
      parentId: parent.id, parentCode: "108", openingBalance: 0, createdAt: serverTimestamp(),
    });
    byCode.set(s.code, { id: ref.id });
  }
  return await fetchAll(C.accounts).catch(() => []);
}
// Gün sonu tarihinden bir sonraki güne geç (valör için varsayılan)
function nextDayISO(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso || todayISO();
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Çok adımlı Gün Sonu Aktarım durumu (adımlar arası korunur)
let gsState = null; // { step, date, kasa:[{yontem,sistem,gerceklesen}], recordId? }
const GS_STEPS = ["Dosya Yükle", "Kasa Kapanış Kontrolü", "Cari Kayıtlar", "Masraflar"];

async function viewGunSonuAktarim(c) {
  if (!gsState) gsState = { step: 0, date: todayISO(), kasa: null };

  const stepper = () => `<div class="stepper">${GS_STEPS.map((s, i) => `
    <div class="step ${i === gsState.step ? "active" : ""} ${i < gsState.step ? "done" : ""}" data-step="${i}">
      <span class="dot">${i < gsState.step ? "✓" : i + 1}</span><span class="lbl">${esc(s)}</span>
    </div>`).join('<div class="step-line"></div>')}</div>`;

  function goto(i) {
    if (i < 0 || i >= GS_STEPS.length) return;
    if (i > 0 && !gsState.kasa) return toast("Önce dosyayı yükleyin.", "err");
    gsState.step = i; render();
  }

  function render() {
    c.innerHTML = `<div class="gs-topbar"><div class="grow"></div><a class="btn btn-sm" href="#/gunsonu-kayitlar">🕘 Geçmiş Kayıtları Gör</a></div>`
      + stepper() + `<div id="gs-body"></div>`;
    $$(".step", c).forEach((el) => el.onclick = () => goto(+el.dataset.step));
    const renderers = [renderUpload, renderKasa, renderCari, renderMasraflar];
    (renderers[gsState.step] || renderUpload)($("#gs-body", c));
  }

  function renderUpload(body) {
    body.innerHTML = `
      <div class="card" style="padding:14px"><div id="gs-drop"></div>
        ${gsState.kasa ? `<div class="notice info" style="margin-top:12px">✔ Kasa sayımları okundu (${gsState.date ? fmtDate(gsState.date) : ""}). <b>İleri</b> ile devam edin.</div>` : ""}
      </div>
      <div class="toolbar" style="margin-top:14px"><div class="grow"></div>
        <button class="btn btn-primary" id="gs-next" ${gsState.kasa ? "" : "disabled"}>İleri →</button></div>`;
    $("#gs-drop", body).appendChild(fileDrop(async (file) => {
      const lb = loadingBar("Dosya okunuyor…");
      try {
        const aoa = await parseSheetAOA(file);
        gsState.kasa = gsExtractKasa(aoa);
        const t = gsExtractTotals(aoa);
        gsState.brut = t.brut; gsState.iskonto = t.iskonto; gsState.ikram = t.ikram;
        if (gsState.x == null) gsState.x = "";
        gsState.date = gsExtractDate(aoa);
        gsState.cariIslem = gsExtractCariIslem(aoa);
        gsState.cariTahsilat = gsExtractCariTahsilat(aoa);
        gsState.masraflar = gsExtractMasraflar(aoa);
        lb.finish(() => { toast("Rapor okundu.", "ok"); goto(1); });
      } catch (e) { lb.finish(() => toast("Okunamadı: " + e.message, "err")); }
    }, ".xlsx,.xls,.csv", true));
    $("#gs-next", body).onclick = () => goto(1);
  }

  function renderKasa(body) {
    const rows = gsState.kasa || [];
    const idxOf = {}; rows.forEach((r, i) => idxOf[r.yontem] = i);
    const groupOf = {}; GS_GROUPS.forEach((g, gi) => g.methods.forEach((m) => groupOf[m] = gi));

    const itemHtml = (name) => {
      const i = idxOf[name];
      if (i == null) return "";
      const r = rows[i];
      return `<div class="gs-trow">
        <div class="gs-tname">${esc(name)}</div>
        <div class="gs-tsis">${fmtNum(parseNum(r.sistem))}</div>
        <div class="gs-treal"><input class="gs-real" data-i="${i}" inputmode="decimal" value="${r.gerceklesen === "" || r.gerceklesen == null ? "" : fmtNum(parseNum(r.gerceklesen))}" placeholder="0,00" /></div>
        <div class="gs-tfark gs-fark" data-i="${i}">—</div>
      </div>`;
    };
    const groupHtml = (g, gi) => {
      const gs = g.methods.reduce((s, m) => s + parseNum(rows[idxOf[m]]?.sistem), 0);
      return `<div class="gs-group">
        <div class="gs-group-head">${esc(g.name)}
          <span class="sub">Sistem <b>${fmtNum(gs)} ₺</b> · Fark <b id="gf-${gi}">—</b></span></div>
        <div class="gs-thead"><span>Ödeme Yöntemi</span><span class="num">Girilen</span><span class="num">Gerçekleşen</span><span class="num">Fark</span></div>
        ${g.methods.map(itemHtml).join("")}
      </div>`;
    };
    const totSistem = rows.reduce((s, r) => s + parseNum(r.sistem), 0);
    const brut = parseNum(gsState.brut), iskonto = parseNum(gsState.iskonto), ikramRep = parseNum(gsState.ikram);
    const xInit = parseNum(gsState.x);
    const ikramNet0 = ikramRep - xInit;
    const netSatis0 = brut - iskonto - ikramNet0;

    body.innerHTML = `
      <div class="card">
        <div class="gs-summary">
          <div class="row"><span class="lab">Gün Sonu Tarihi</span><input type="date" id="gs-date" value="${esc(gsState.date)}" /></div>
          <div class="row"><span class="lab">Brüt Satış</span><span class="val">${fmtNum(brut)} ₺</span></div>
          <div class="row"><span class="lab">İskonto</span><span class="val">${fmtNum(iskonto)} ₺</span></div>
          <div class="row"><span class="lab">İkram</span><span class="val" id="gs-ikram">${fmtNum(ikramNet0)} ₺</span></div>
          <div class="row"><span class="lab">X <small>(İkram'dan düşülür)</small></span><input id="gs-x" inputmode="decimal" value="${gsState.x === "" || gsState.x == null ? "" : fmtNum(xInit)}" placeholder="0,00" /></div>
          <div class="row net"><span class="lab">Net Satış</span><span class="val" id="gs-net">${fmtNum(netSatis0)} ₺</span></div>
        </div>
        <div class="card-head"><h3>Kasa Kapanış Kontrolü</h3><span class="hint">Gerçekleşen (sayım) tutarlarını girin</span></div>
        ${GS_GROUPS.map(groupHtml).join("")}
        <div class="gs-ttotal">
          <span class="lbl">GENEL TOPLAM</span>
          <span class="v">${fmtNum(totSistem)}</span>
          <span class="v" id="tot-real">—</span>
          <span class="v" id="tot-fark">—</span>
        </div>
        <div class="gs-prog"><div class="bar" id="gs-prog-bar" style="width:0%"></div></div>
        <div class="gs-prog-lbl"><span id="gs-prog-lbl">0/${rows.length}</span> satır kontrol edildi</div>
      </div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" id="gs-back">← Geri</button>
        <!-- TEST — geçici: Gerçekleşen'i Girilen'den otomatik doldurur (silinecek) -->
        <button class="btn btn-sm" id="gs-fill" title="Test amaçlı: tüm Gerçekleşen = Girilen">⚡ Test: Doldur</button>
        <div class="grow"></div>
        <button class="btn btn-primary" id="gs-next2">İleri →</button>
      </div>`;

    const recompute = () => {
      const gFark = {}; let tr = 0, tf = 0, any = false;
      $$(".gs-real", body).forEach((inp) => {
        const i = +inp.dataset.i;
        const v = inp.value.trim();
        rows[i].gerceklesen = v === "" ? "" : parseNum(v);
        const fc = $(`.gs-fark[data-i="${i}"]`, body);
        if (v === "") { fc.textContent = "—"; fc.style.color = ""; }
        else {
          const f = parseNum(v) - parseNum(rows[i].sistem);
          const gi = groupOf[rows[i].yontem];
          gFark[gi] = (gFark[gi] || 0) + f;
          any = true; tr += parseNum(v); tf += f;
          fc.textContent = fmtNum(f);
          fc.style.color = f < 0 ? "var(--danger)" : f > 0 ? "var(--ok)" : "";
        }
      });
      GS_GROUPS.forEach((g, gi) => {
        const el = $(`#gf-${gi}`, body);
        if (!el) return;
        if (gi in gFark) { el.textContent = fmtNum(gFark[gi]); el.style.color = gFark[gi] < 0 ? "var(--danger)" : gFark[gi] > 0 ? "var(--ok)" : ""; }
        else { el.textContent = "—"; el.style.color = ""; }
      });
      const tre = $("#tot-real", body), tfe = $("#tot-fark", body);
      tre.textContent = any ? fmtNum(tr) : "—";
      tfe.textContent = any ? fmtNum(tf) : "—";
      tfe.style.color = any ? (tf < 0 ? "#ffd9d0" : tf > 0 ? "#cfeeda" : "") : "";
      const pb = $("#gs-prog-bar", body), pl = $("#gs-prog-lbl", body);
      if (pb) {
        const filled = rows.filter((r) => r.gerceklesen !== "" && r.gerceklesen != null).length;
        pb.style.width = Math.round((filled / (rows.length || 1)) * 100) + "%";
        if (pl) pl.textContent = filled + "/" + rows.length;
      }
    };
    body.addEventListener("input", rafThrottle(recompute));
    $$(".gs-real", body).forEach((inp) => inp.addEventListener("blur", () => {
      if (inp.value.trim() !== "") {
        inp.value = fmtNum(parseNum(inp.value));
        const row = inp.closest(".gs-trow");
        if (row) { row.classList.remove("flash-y"); void row.offsetWidth; row.classList.add("flash-y"); }
      }
    }));
    recompute();

    // Tepe: X → İkram (canlı düşer) ve Net Satış
    const xInp = $("#gs-x", body);
    const recomputeTop = () => {
      const v = xInp.value.trim();
      gsState.x = v === "" ? "" : parseNum(v);
      const x = parseNum(gsState.x);
      const ikramNet = ikramRep - x;
      const netSatis = brut - iskonto - ikramNet;
      $("#gs-ikram", body).textContent = fmtNum(ikramNet) + " ₺";
      $("#gs-net", body).textContent = fmtNum(netSatis) + " ₺";
    };
    xInp.addEventListener("input", recomputeTop);
    xInp.addEventListener("blur", () => { if (xInp.value.trim() !== "") xInp.value = fmtNum(parseNum(xInp.value)); });

    const dInp = $("#gs-date", body);
    if (dInp) dInp.addEventListener("change", () => { gsState.date = dInp.value || gsState.date; });

    $("#gs-back", body).onclick = () => goto(0);
    $("#gs-next2", body).onclick = () => { if (dInp) gsState.date = dInp.value || gsState.date; goto(2); };

    // TEST — geçici: tüm Gerçekleşen'i Girilen'den doldur (silinecek)
    $("#gs-fill", body).onclick = () => {
      rows.forEach((r, i) => {
        const v = parseNum(r.sistem);
        r.gerceklesen = v;
        const inp = $(`.gs-real[data-i="${i}"]`, body);
        if (inp) inp.value = v ? fmtNum(v) : "";
      });
      recompute();
      toast("Gerçekleşenler girilenden dolduruldu.", "ok");
    };
  }

  // ---- Adım 3: Cari Kayıtlar (Cari İşlemler · Cari Tahsilatlar · Blokeye Aktarımlar) ----
  async function renderCari(body) {
    body.innerHTML = `<div class="empty" style="padding:28px"><div class="spinner" style="margin:0 auto"></div></div>`;
    gsState.cariIslem = gsState.cariIslem || [];
    gsState.cariTahsilat = gsState.cariTahsilat || [];
    const bl = gsState.bloke = gsState.bloke || {};
    if (!bl.tarih) bl.tarih = nextDayISO(gsState.date);
    if (!bl.valor) bl.valor = nextDayISO(gsState.date);
    if (bl.garantiKredi == null) bl.garantiKredi = "";
    if (bl.garantiKomisyon == null) bl.garantiKomisyon = "";
    if (bl.garantiDebit == null) bl.garantiDebit = "";
    if (!bl.rowValor) bl.rowValor = {};

    const accounts = await ensureBlokeAccounts();
    const codeToName = {};
    accounts.forEach((a) => { if (a.code) codeToName[String(a.code)] = a.name; });
    const money = (v) => (v === "" || v == null) ? "" : fmtNum(parseNum(v));

    const listCard = (title, hint, key) => {
      const rows = gsState[key];
      const tot = rows.reduce((s, r) => s + parseNum(r.tutar), 0);
      const rowsHtml = rows.map((r, i) => `
        <div class="ci-row">
          <input class="ci-sahis" data-key="${key}" data-i="${i}" value="${esc(r.sahis)}" placeholder="Şahıs / Cari" />
          <div class="ci-amt"><input class="num ci-tutar" data-key="${key}" data-i="${i}" inputmode="decimal" value="${esc(money(r.tutar))}" placeholder="0,00" /><span class="cur">₺</span></div>
        </div>`).join("");
      return `<div class="card">
        <div class="card-head"><h3>${esc(title)}</h3><span class="hint">${esc(hint)}</span></div>
        <div class="ci-list">${rowsHtml || `<div class="empty" style="padding:14px"><p>Kayıt yok.</p></div>`}</div>
        <div class="ci-toplam"><span>Toplam</span><b data-tot="${key}">${fmtTRY(tot)}</b></div>
      </div>`;
    };

    const rowKey = (r) => r.code + "-" + r.tip;
    const blRowHtml = (r) => {
      const key = rowKey(r);
      const rv = bl.rowValor[key] || bl.valor;
      let amtCell;
      if (r.tip === "kredi") {
        amtCell = `<div class="bl-kredi">
          <label><span>Tutar</span><input class="num bl-input" data-tip="kredi" inputmode="decimal" value="${esc(money(bl.garantiKredi))}" placeholder="0,00" /></label>
          <label><span>Komisyon</span><input class="num bl-input" data-tip="komisyon" inputmode="decimal" value="${esc(money(bl.garantiKomisyon))}" placeholder="0,00" /></label>
        </div>`;
      } else if (r.manual) {
        amtCell = `<input class="num bl-input" data-tip="${r.tip}" inputmode="decimal" value="${esc(money(bl.garantiDebit))}" placeholder="0,00" />`;
      } else {
        amtCell = `<b class="bl-val" data-tip="${r.tip}">${fmtNum(r.borc)}</b>`;
      }
      return `<div class="bl-trow${r.tip === "kredi" ? " tall" : ""}">
        <div class="bl-cname">
          <div class="bl-name">${esc(r.name)}${r.aciklama ? ` <span class="bl-tag">${esc(r.aciklama)}</span>` : ""}</div>
          <div class="bl-sub">${esc(r.code)}</div>
        </div>
        <div class="bl-camt">${amtCell}</div>
        <div class="bl-cvalor"><input type="date" class="bl-valor-row" data-key="${key}" value="${esc(rv)}" /></div>
      </div>`;
    };

    const blokeCard = () => {
      const rows = gsComputeBlokeRows(gsState, codeToName);
      const tot = rows.reduce((s, r) => s + parseNum(r.borc), 0);
      return `<div class="card">
        <div class="card-head"><h3>Blokeye Aktarımlar</h3><span class="hint">108 bloke hesaplarına Borç</span></div>
        <div class="bl-table">
          <div class="bl-thead"><span>Hesap</span><span class="num">Tutar ₺</span><span>Valör</span></div>
          ${rows.map(blRowHtml).join("")}
        </div>
        <div class="gs-total"><span>TOPLAM BLOKE</span><span class="tt">Borç <b id="bl-tot">${fmtTRY(tot)}</b></span></div>
        <div style="font-size:11.5px;color:var(--ink-faint);margin-top:8px">
          Garanti <b>Kredi Kartı</b> (Tutar + Komisyon) ve <b>Debit Kartı</b> elle; <b>Yurt Dışı</b> otomatik
          (Garanti Gerçekleşen − Kredi − Debit). Her satırın valör tarihi ayrı ayarlanabilir.
        </div>
      </div>`;
    };

    body.innerHTML = `
      ${listCard("Cari İşlemler", "Kredili satışlar → cari borç", "cariIslem")}
      ${listCard("Cari Tahsilatlar", "Tahsilatlar → cari alacak", "cariTahsilat")}
      ${blokeCard()}
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" id="gs-back2">← Geri</button>
        <div class="grow"></div>
        <button class="btn btn-primary" id="gs-next3">İleri →</button>
      </div>`;

    // Cari liste düzenleme
    const refreshTot = (key) => {
      const tot = gsState[key].reduce((s, r) => s + parseNum(r.tutar), 0);
      const el = $(`[data-tot="${key}"]`, body); if (el) el.textContent = fmtTRY(tot);
    };
    $$(".ci-sahis", body).forEach((inp) => inp.addEventListener("input", () => {
      gsState[inp.dataset.key][+inp.dataset.i].sahis = inp.value;
    }));
    $$(".ci-tutar", body).forEach((inp) => {
      inp.addEventListener("input", () => {
        gsState[inp.dataset.key][+inp.dataset.i].tutar = parseNum(inp.value);
        refreshTot(inp.dataset.key);
      });
      inp.addEventListener("blur", () => { const n = parseNum(inp.value); inp.value = n ? fmtNum(n) : ""; });
      inp.addEventListener("focus", () => inp.select());
    });

    // Her satır için ayrı valör tarihi
    $$(".bl-valor-row", body).forEach((inp) => inp.addEventListener("change", () => {
      bl.rowValor[inp.dataset.key] = inp.value || bl.valor;
    }));

    // Garanti Kredi/Debit → Yurt Dışı + toplam canlı
    const recomputeBloke = () => {
      $$(".bl-input", body).forEach((inp) => {
        const v = inp.value.trim() === "" ? "" : parseNum(inp.value);
        if (inp.dataset.tip === "kredi") bl.garantiKredi = v;
        else if (inp.dataset.tip === "komisyon") bl.garantiKomisyon = v;
        else if (inp.dataset.tip === "debit") bl.garantiDebit = v;
      });
      const rows = gsComputeBlokeRows(gsState, codeToName);
      const yd = rows.find((r) => r.tip === "yurtdisi");
      const ydEl = $('.bl-val[data-tip="yurtdisi"]', body);
      if (ydEl && yd) { ydEl.textContent = fmtNum(yd.borc); ydEl.style.color = yd.borc < 0 ? "var(--danger)" : ""; }
      const totEl = $("#bl-tot", body);
      if (totEl) totEl.textContent = fmtTRY(rows.reduce((s, r) => s + parseNum(r.borc), 0));
    };
    $$(".bl-input", body).forEach((inp) => {
      inp.addEventListener("input", recomputeBloke);
      inp.addEventListener("blur", () => { const n = parseNum(inp.value); inp.value = n ? fmtNum(n) : ""; });
      inp.addEventListener("focus", () => inp.select());
    });
    recomputeBloke();

    $("#gs-back2", body).onclick = () => goto(1);
    $("#gs-next3", body).onclick = () => goto(3);
  }

  // ---- Adım 4: Masraflar ----
  function renderMasraflar(body) {
    gsState.masraflar = gsState.masraflar || [];
    const money = (v) => (v === "" || v == null) ? "" : fmtNum(parseNum(v));
    const rows = gsState.masraflar;
    const tot = rows.reduce((s, r) => s + parseNum(r.tutar), 0);
    const rowsHtml = rows.map((r, i) => `
      <div class="mf-row">
        <textarea class="mf-ad" data-i="${i}" rows="1" placeholder="Açıklama">${esc(r.ad)}</textarea>
        <input class="mf-rapor" data-i="${i}" value="${esc(r.rapor || "")}" placeholder="—" />
        <div class="mf-amt"><input class="num mf-tutar" data-i="${i}" inputmode="decimal" value="${esc(money(r.tutar))}" placeholder="0,00" /><span class="cur">₺</span></div>
      </div>`).join("");

    body.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Masraflar</h3><span class="hint">Rapordaki "Masraflar Toplamı" satırları</span></div>
        <div class="mf-thead"><span>Açıklama <small>(uzunsa dokun)</small></span><span>Rapor</span><span class="num">Tutar</span></div>
        <div class="mf-list">${rowsHtml || `<div class="empty" style="padding:14px"><p>Masraf satırı bulunamadı.</p></div>`}</div>
        <div class="toolbar" style="margin-top:10px">
          <button class="btn btn-sm" id="mf-add">+ Satır Ekle</button>
          <div class="grow"></div>
          <div style="font-weight:800">Toplam <span id="mf-tot">${fmtTRY(tot)}</span></div>
        </div>
      </div>
      <div class="toolbar" style="margin-top:14px">
        <button class="btn" id="gs-back3">← Geri</button>
        <div class="grow"></div>
        <button class="btn btn-primary" id="gs-save">💾 Kaydet</button>
      </div>`;

    const refreshTot = () => { $("#mf-tot", body).textContent = fmtTRY(rows.reduce((s, r) => s + parseNum(r.tutar), 0)); };
    // Açıklama: dokununca Excel açıklama kutusu gibi büyür (auto-grow), çıkınca tek satıra döner
    const grow = (ta) => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 180) + "px"; };
    $$(".mf-ad", body).forEach((ta) => {
      ta.addEventListener("focus", () => grow(ta));
      ta.addEventListener("input", () => { rows[+ta.dataset.i].ad = ta.value; grow(ta); });
      ta.addEventListener("blur", () => { ta.style.height = ""; });
    });
    $$(".mf-rapor", body).forEach((inp) => inp.addEventListener("input", () => { rows[+inp.dataset.i].rapor = inp.value; }));
    $$(".mf-tutar", body).forEach((inp) => {
      inp.addEventListener("input", () => { rows[+inp.dataset.i].tutar = parseNum(inp.value); refreshTot(); });
      inp.addEventListener("blur", () => { const n = parseNum(inp.value); inp.value = n ? fmtNum(n) : ""; });
      inp.addEventListener("focus", () => inp.select());
    });
    $("#mf-add", body).onclick = () => { rows.push({ ad: "", rapor: "", tutar: 0 }); renderMasraflar(body); };

    $("#gs-back3", body).onclick = () => goto(2);
    $("#gs-save", body).onclick = () => saveGunSonu();
  }

  async function saveGunSonu() {
    const date = gsState.date || todayISO();
    gsState.date = date;
    const rows = gsState.kasa.map((r) => ({
      yontem: r.yontem, sistem: parseNum(r.sistem),
      gerceklesen: r.gerceklesen === "" || r.gerceklesen == null ? "" : parseNum(r.gerceklesen),
      fark: r.gerceklesen === "" || r.gerceklesen == null ? "" : parseNum(r.gerceklesen) - parseNum(r.sistem),
    }));
    const x = parseNum(gsState.x);
    const ikramNet = parseNum(gsState.ikram) - x;
    const netSatis = parseNum(gsState.brut) - parseNum(gsState.iskonto) - ikramNet;

    // Bölüm 1 & 2 — temizlenmiş cari listeleri
    const cleanList = (arr) => (arr || [])
      .map((r) => ({ sahis: String(r.sahis || "").trim(), tutar: parseNum(r.tutar) }))
      .filter((r) => r.sahis || r.tutar);
    const cariIslem = cleanList(gsState.cariIslem);
    const cariTahsilat = cleanList(gsState.cariTahsilat);
    const masraflar = (gsState.masraflar || [])
      .map((r) => ({ ad: String(r.ad || "").trim(), rapor: String(r.rapor || "").trim(), tutar: parseNum(r.tutar) }))
      .filter((r) => r.ad || r.tutar);
    const bl = gsState.bloke || {};
    const blokePayload = {
      tarih: date, valor: bl.valor || nextDayISO(date),
      garantiKredi: parseNum(bl.garantiKredi), garantiKomisyon: parseNum(bl.garantiKomisyon),
      garantiDebit: parseNum(bl.garantiDebit),
      rowValor: bl.rowValor || {},
    };

    const payload = {
      type: "gunsonu", date, kasa: rows,
      brut: parseNum(gsState.brut), iskonto: parseNum(gsState.iskonto),
      ikram: parseNum(gsState.ikram), x: gsState.x === "" || gsState.x == null ? "" : x,
      ikramNet, netSatis,
      cariIslem, cariTahsilat, masraflar, bloke: blokePayload,
      cariIslemTotal: cariIslem.reduce((s, r) => s + r.tutar, 0),
      cariTahsilatTotal: cariTahsilat.reduce((s, r) => s + r.tutar, 0),
      masraflarTotal: masraflar.reduce((s, r) => s + r.tutar, 0),
      total: rows.reduce((s, r) => s + parseNum(r.sistem), 0),
      rowCount: rows.length, status: "aktarildi",
      updatedAt: serverTimestamp(), updatedBy: currentUser.email,
    };
    // ---- Cari plan: her şahsı 120 Müşteri hesabına eşle; yoksa oluşturulacak; aynı tarih+tutar uyarısı
    const accounts = await fetchAll(C.accounts).catch(() => []);
    const preEntries = await fetchAll(C.accountEntries).catch(() => []);
    const musteri = accounts.filter((a) => a.type === "musteri");
    const byName = new Map(musteri.map((a) => [normTr(a.name), a]));
    const cariItems = [
      ...cariIslem.map((r) => ({ name: r.sahis, tutar: r.tutar, side: "borc" })),
      ...cariTahsilat.map((r) => ({ name: r.sahis, tutar: r.tutar, side: "alacak" })),
    ].filter((it) => it.name && it.tutar);
    const missing = [], mset = new Set();
    cariItems.forEach((it) => { const k = normTr(it.name); if (!byName.has(k) && !mset.has(k)) { mset.add(k); missing.push(it.name); } });
    // Aynı tarih+tutar mükerreri işaretle (varsayılan: aktarma)
    cariItems.forEach((it) => {
      const acc = byName.get(normTr(it.name));
      it.isDup = !!acc && !!it.tutar && preEntries.some((e) => e.accountId === acc.id && e.date === date && e.gunSonuKey !== date &&
        parseNum(it.side === "borc" ? e.borc : e.alacak) === it.tutar);
    });
    const dupItems = cariItems.filter((it) => it.isDup);

    const doCommit = async (items) => {
      try {
        // 1) Eksik carileri 120 Alıcılar altına oluştur
        let main = accounts.find((a) => a.type === "musteri" && !a.parentId) || accounts.find((a) => a.type === "musteri");
        if (!main && cariItems.length) {
          const ref = await addDoc(C.accounts(), { code: "120", name: "Alıcı Hesaplar (Müşteriler)", type: "musteri", parentId: null, parentCode: null, openingBalance: 0, createdAt: serverTimestamp() });
          main = { id: ref.id, code: "120", name: "Alıcı Hesaplar (Müşteriler)", type: "musteri" };
          accounts.push(main); byName.set(normTr(main.name), main);
        }
        for (const nm of missing) {
          const siblings = accounts.filter((a) => a.parentId === main.id);
          const code = nextSubCode(main, siblings);
          const ref = await addDoc(C.accounts(), { code, name: nm, type: "musteri", parentId: main.id, parentCode: main.code, openingBalance: 0, createdAt: serverTimestamp() });
          const acc = { id: ref.id, code, name: nm, type: "musteri", parentId: main.id };
          accounts.push(acc); byName.set(normTr(nm), acc);
        }
        // 2) Gün sonu kaydını yaz
        let editing = !!gsState.recordId;
        if (gsState.recordId) {
          await updateDoc(doc(db, "dayEndRecords", gsState.recordId), payload);
        } else {
          const same = (await fetchAll(C.dayEndRecords, where("date", "==", date))).find((e) => e.type === "gunsonu");
          if (same) { await updateDoc(doc(db, "dayEndRecords", same.id), payload); editing = true; }
          else await addDoc(C.dayEndRecords(), { ...payload, notes: [], createdAt: serverTimestamp(), createdBy: currentUser.email });
        }
        // 3) Bloke (108) + Nakit/Ödemeler (100) + Cari (120) hareketleri (hepsi idempotent)
        await postBlokeEntries(date, blokePayload, masraflar);
        await postCariEntries(date, items, byName);
        await logAction(editing ? "Düzenleme" : "Ekleme", "Gün Sonu", fmtDate(date));
        toast("Gün sonu kaydedildi.", "ok");
        gsState = null;
        successAnim("Gün sonu kaydedildi", () => { location.hash = "#/gunsonu-kayitlar"; });
        return;
      } catch (e) { toast("Kaydedilemedi: " + e.message, "err"); }
    };

    if (missing.length || dupItems.length) {
      const bodyEl = document.createElement("div");
      bodyEl.innerHTML =
        (missing.length ? `<div style="margin-bottom:10px"><b>🆕 Şu cariler yok, otomatik oluşturulacak:</b><ul style="margin:6px 0 0;padding-left:20px">${missing.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "") +
        (dupItems.length ? `<div class="notice warn" style="margin:0">
          <b>⚠️ Aynı tarih ve tutarda zaten kayıt var</b>
          <div style="font-size:12px;color:var(--ink-soft);margin:2px 0 8px">Aktarmak istediğini işaretle; işaretsizler <b>atlanır</b>.</div>
          ${dupItems.map((it) => `<label style="display:flex;align-items:center;gap:9px;padding:6px 0;cursor:pointer">
            <input type="checkbox" class="dup-chk" data-i="${cariItems.indexOf(it)}" style="width:18px;height:18px;flex:0 0 auto" />
            <span>${esc(it.name)} · <b>${fmtTRY(it.tutar)}</b> · ${it.side === "borc" ? "Borç" : "Alacak"}</span>
          </label>`).join("")}
        </div>` : "");
      const m = openModal({ title: "Cari Kayıtları — Onay", body: bodyEl, footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Onayla ve Kaydet", "btn-primary", () => {
          const keep = new Set();
          $$(".dup-chk", bodyEl).forEach((chk) => { if (chk.checked) keep.add(+chk.dataset.i); });
          const finalItems = cariItems.filter((it, i) => !it.isDup || keep.has(i));
          m.close(); doCommit(finalItems);
        }),
      ]});
      return;
    }
    doCommit(cariItems);
  }

  // Cari (borç/alacak) hareketlerini 120 müşteri hesaplarına yazar (idempotent).
  async function postCariEntries(date, cariItems, byName) {
    const fresh = await fetchAll(C.accountEntries).catch(() => []);
    const isStale = (e) => e.source === "gunsonu-cari" && e.gunSonuKey === date;
    for (const e of fresh.filter(isStale)) await deleteDoc(doc(db, "accountEntries", e.id));
    const remaining = fresh.filter((e) => !isStale(e));
    let gno = remaining.reduce((m, e) => Math.max(m, e.islemNo || 0), 0);
    const cnoMap = new Map();
    const docs = [];
    for (const it of cariItems) {
      const acc = byName.get(normTr(it.name));
      if (!acc || !it.tutar) continue;
      if (!cnoMap.has(acc.id))
        cnoMap.set(acc.id, remaining.filter((e) => e.accountId === acc.id).reduce((m, e) => Math.max(m, e.cariNo || 0), 0));
      const cno = cnoMap.get(acc.id) + 1; cnoMap.set(acc.id, cno);
      gno++;
      docs.push({
        accountId: acc.id, accountCode: acc.code || "",
        islemNo: gno, cariNo: cno,
        date, sahis: it.name,
        aciklama: `Gün Sonu ${it.side === "borc" ? "Kredili Satış" : "Tahsilat"}`,
        borc: it.side === "borc" ? it.tutar : 0,
        alacak: it.side === "alacak" ? it.tutar : 0,
        faturaTuru: "", faturaNo: "",
        source: "gunsonu-cari", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      });
    }
    if (docs.length) await batchAdd(C.accountEntries, docs);
  }

  // Bloke satırlarını 108 hesap defterlerine + Nakit/Ödemeleri 100 Kasa'ya yazar (idempotent).
  async function postBlokeEntries(date, blokePayload, masraflar) {
    const accounts = await ensureBlokeAccounts();
    const codeToId = {}, codeToName = {};
    accounts.forEach((a) => { if (a.code) { codeToId[String(a.code)] = a.id; codeToName[String(a.code)] = a.name; } });

    const existing = await fetchAll(C.accountEntries).catch(() => []);
    const isStale = (e) => (e.source === "gunsonu-bloke" || e.source === "gunsonu-nakit" || e.source === "gunsonu-masraf") && e.gunSonuKey === date;
    for (const e of existing.filter(isStale)) await deleteDoc(doc(db, "accountEntries", e.id));
    const remaining = existing.filter((e) => !isStale(e));

    // Açıklama: "{gün sonu tarihi} {isim} Çekimi"  (ör. 08.04.2026 Garanti Kredi Kartı Çekimi · 08.04.2026 Metropol Çekimi)
    const cekimAd = (r) => r.aciklama
      ? "Garanti " + r.aciklama
      : String(r.name || "").replace(/\s*Bloke Hesab[ıi]\s*$/i, "").trim();

    const blokeRows = gsComputeBlokeRows(gsState, codeToName).filter((r) => parseNum(r.borc));
    let gno = remaining.reduce((m, e) => Math.max(m, e.islemNo || 0), 0);
    const cnoMap = new Map();
    const docs = blokeRows.map((r) => {
      const accId = codeToId[r.code];
      if (!accId) return null;
      if (!cnoMap.has(accId))
        cnoMap.set(accId, remaining.filter((e) => e.accountId === accId).reduce((m, e) => Math.max(m, e.cariNo || 0), 0));
      const cno = cnoMap.get(accId) + 1; cnoMap.set(accId, cno);
      gno++;
      const rv = (blokePayload.rowValor && blokePayload.rowValor[r.code + "-" + r.tip]) || blokePayload.valor;
      return {
        accountId: accId, accountCode: r.code,
        islemNo: gno, cariNo: cno,
        date: blokePayload.tarih, valor: rv,
        islemAdi: "BLOKEYE ALMA", sahis: r.name,
        aciklama: `${cekimAd(r)} Çekimi`, rapor: "",
        borc: parseNum(r.borc), alacak: 0,
        faturaTuru: "", faturaNo: fmtDate(rv),
        source: "gunsonu-bloke", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      };
    }).filter(Boolean);

    // 100 Kasa: gerçek nakit girişi = sayılan Nakit (Gerçekleşen) + gün içi nakit ödemeler (Masraflar);
    //           sonra her ödeme (masraf) kasadan Çıkan yapılır. Net etki = sayılan nakit.
    const nakitRow = (gsState.kasa || []).find((r) => normTr(r.yontem) === "nakit");
    const nakit = nakitRow && !(nakitRow.gerceklesen === "" || nakitRow.gerceklesen == null) ? parseNum(nakitRow.gerceklesen) : 0;
    const masrafList = (masraflar || []).filter((m) => parseNum(m.tutar));
    const masrafTot = masrafList.reduce((s, m) => s + parseNum(m.tutar), 0);
    const kasaId = codeToId["100"];
    if (kasaId && (nakit || masrafTot)) {
      gno++;
      docs.push({
        accountId: kasaId, accountCode: "100",
        islemNo: gno, date: blokePayload.tarih,
        islemAdi: "Gün Sonu", sahis: "",
        aciklama: `Nakit Girişi`, rapor: "",
        giren: nakit + masrafTot, cikan: 0,
        source: "gunsonu-nakit", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      });
      for (const m of masrafList) {
        gno++;
        docs.push({
          accountId: kasaId, accountCode: "100",
          islemNo: gno, date: blokePayload.tarih,
          islemAdi: "Ödeme", sahis: "",
          aciklama: `${m.ad || "Ödeme"}`, rapor: m.rapor || "",
          giren: 0, cikan: parseNum(m.tutar),
          source: "gunsonu-masraf", gunSonuKey: date,
          createdAt: serverTimestamp(), createdBy: currentUser.email,
        });
      }
    }

    if (docs.length) await batchAdd(C.accountEntries, docs);
  }

  render();
}

// ===========================================================================
//  MODÜL: GÜN SONU — KAYITLAR (arşiv, yalnızca yetkili düzenler)
// ===========================================================================
async function viewGunSonuKayitlar(c) {
  const records = (await fetchAll(C.dayEndRecords))
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  c.innerHTML = `
    <div class="gs-topbar"><a class="btn btn-sm" href="#/gunsonu-aktarim">← Gün Sonu Aktarımı</a><div class="grow"></div></div>
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
        : `<div class="empty"><div class="ico">🗂️</div><p>Henüz gün sonu kaydı yok.</p><a class="btn btn-primary btn-sm" href="#/gunsonu-aktarim">Gün Sonu Aktarımı</a></div>`}
    </div>`;

  const byId = (id) => records.find((r) => r.id === id);
  const openGunSonu = (rec) => {
    gsState = {
      step: 1, date: rec.date || todayISO(),
      kasa: (rec.kasa || []).map((r) => ({ ...r })),
      brut: rec.brut || 0, iskonto: rec.iskonto || 0, ikram: rec.ikram || 0,
      x: rec.x == null ? "" : rec.x,
      cariIslem: (rec.cariIslem || []).map((r) => ({ ...r })),
      cariTahsilat: (rec.cariTahsilat || []).map((r) => ({ ...r })),
      masraflar: (rec.masraflar || []).map((r) => ({ ...r })),
      bloke: rec.bloke ? { ...rec.bloke } : null,
      recordId: rec.id,
    };
    location.hash = "#/gunsonu-aktarim";
  };
  $$("[data-view]", c).forEach((b) => b.onclick = () => {
    const r = byId(b.dataset.view); r.type === "gunsonu" ? openGunSonu(r) : openRecordModal(r, false);
  });
  $$("[data-edit]", c).forEach((b) => b.onclick = () => {
    const r = byId(b.dataset.edit); r.type === "gunsonu" ? openGunSonu(r) : openRecordModal(r, true);
  });
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
// Ödeme yöntemi görseli (emoji)
const gsPayEmoji = (n) => {
  const k = normTr(n);
  if (k.includes("nakit")) return "💵";
  if (k.includes("garanti")) return "🟢";
  if (k.includes("finans")) return "🔵";
  if (k.includes("havale")) return "🏦";
  if (k.includes("yemek sepeti")) return "🍽️";
  if (k.includes("getir")) return "🛵";
  if (k.includes("trendyol")) return "🛒";
  if (k.includes("ticket") || k.includes("edenred")) return "🎟️";
  if (k.includes("multinet")) return "💠";
  if (k.includes("sodex") || k.includes("pluxee")) return "🍔";
  if (k.includes("metropol")) return "🏙️";
  if (k.includes("set")) return "🏢";
  return "💳";
};

async function viewGunSonuRapor(c) {
  const records = (await fetchAll(C.dayEndRecords))
    .filter((r) => r.type === "gunsonu")
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  c.innerHTML = `
    <div class="card rep-noprint">
      <div class="card-head"><h3>Gün Sonu Raporu</h3><span class="hint">Bir gün seçin — sade, görsel özet çıkar</span></div>
      ${records.length ? `<div class="field" style="margin:0;max-width:340px">
        <label>📅 Gün Seçin</label>
        <select id="rep-date">${records.map((r) => `<option value="${r.id}">${fmtDate(r.date)} · Net ${fmtTRY(r.netSatis || 0)}</option>`).join("")}</select>
      </div>` : `<div class="empty"><div class="ico">🧾</div><p>Henüz gün sonu kaydı yok.</p><a class="btn btn-primary btn-sm" href="#/gunsonu-aktarim">Gün Sonu Aktarımı</a></div>`}
    </div>
    <div id="rep-body"></div>`;

  if (!records.length) return;
  const sel = $("#rep-date", c);
  sel.addEventListener("change", () => renderReport(records.find((r) => r.id === sel.value)));
  renderReport(records[0]);

  function renderReport(rec) {
    const body = $("#rep-body", c);
    if (!rec) { body.innerHTML = ""; return; }
    const actual = (m) => (m.gerceklesen === "" || m.gerceklesen == null) ? parseNum(m.sistem) : parseNum(m.gerceklesen);
    const methods = (rec.kasa || []).map((m) => ({ yontem: m.yontem, tutar: actual(m) })).filter((m) => m.tutar > 0).sort((a, b) => b.tutar - a.tutar);
    const payTotal = methods.reduce((s, m) => s + m.tutar, 0);
    const maxPay = methods.reduce((mx, m) => Math.max(mx, m.tutar), 0) || 1;
    const brut = parseNum(rec.brut), iskonto = parseNum(rec.iskonto);
    const ikramNet = parseNum(rec.ikramNet != null ? rec.ikramNet : rec.ikram), net = parseNum(rec.netSatis);
    const tahsilat = rec.cariTahsilat || [], cariIslem = rec.cariIslem || [], masraflar = rec.masraflar || [];
    const tahTot = rec.cariTahsilatTotal != null ? rec.cariTahsilatTotal : tahsilat.reduce((s, r) => s + parseNum(r.tutar), 0);
    const cariTot = rec.cariIslemTotal != null ? rec.cariIslemTotal : cariIslem.reduce((s, r) => s + parseNum(r.tutar), 0);
    const masTot = rec.masraflarTotal != null ? rec.masraflarTotal : masraflar.reduce((s, r) => s + parseNum(r.tutar), 0);
    const notes = rec.notes || [];
    // Girilen (sistem) ↔ Gerçekleşen (sayım) farkları
    const sayim = (rec.kasa || []).map((m) => {
      const sis = parseNum(m.sistem);
      const hasGer = !(m.gerceklesen === "" || m.gerceklesen == null);
      const ger = hasGer ? parseNum(m.gerceklesen) : null;
      return { yontem: m.yontem, sis, ger, hasGer, fark: hasGer ? ger - sis : null };
    }).filter((m) => m.sis > 0 || m.hasGer);
    const anyGer = sayim.some((m) => m.hasGer);
    const totSis = sayim.reduce((s, m) => s + m.sis, 0);
    const totGer = sayim.reduce((s, m) => s + (m.hasGer ? m.ger : 0), 0);
    const totFark = sayim.reduce((s, m) => s + (m.fark || 0), 0);
    const farkCls = (f) => f < 0 ? "neg" : f > 0 ? "pos" : "";
    const liList = (arr, keyName) => arr.length
      ? arr.map((r) => `<div class="rep-li"><span>${esc(r[keyName])}${r.rapor ? ` <small>(${esc(r.rapor)})</small>` : ""}</span><b>${fmtTRY(parseNum(r.tutar))}</b></div>`).join("")
      : `<div class="rep-empty">— yok —</div>`;

    body.innerHTML = `
      <div class="rep-controls rep-noprint">
        <button class="btn btn-primary" id="rep-print">📄 PDF İndir / Paylaş</button>
        <span class="hint">Butona bas → <b>PDF olarak kaydet</b> ya da WhatsApp ile paylaş</span>
      </div>
      <div id="gs-report">
        <div class="rep-head">
          <div class="rep-logo">🧾</div>
          <div><div class="rep-title">Güllüoğlu Kübban — Gün Sonu</div><div class="rep-date">${fmtDate(rec.date)}</div></div>
        </div>

        <div class="rep-hero">
          <div class="rep-hero-lbl">BUGÜNKÜ NET SATIŞ</div>
          <div class="rep-hero-val">${fmtTRY(net)}</div>
        </div>

        <div class="rep-tiles">
          <div class="rep-tile"><div class="ic">💰</div><div class="l">Brüt Satış</div><div class="v">${fmtTRY(brut)}</div></div>
          <div class="rep-tile red"><div class="ic">🏷️</div><div class="l">İskonto</div><div class="v">${fmtTRY(iskonto)}</div></div>
          <div class="rep-tile red"><div class="ic">🎁</div><div class="l">İkram</div><div class="v">${fmtTRY(ikramNet)}</div></div>
          <div class="rep-tile green"><div class="ic">✅</div><div class="l">Net Satış</div><div class="v">${fmtTRY(net)}</div></div>
        </div>

        <div class="rep-sec">
          <div class="rep-sec-h"><span>💳 Para Nasıl Geldi?</span><b>${fmtTRY(payTotal)}</b></div>
          <div class="rep-bars">
            ${methods.map((m) => `
              <div class="rep-bar-row">
                <div class="rep-bar-top"><span>${gsPayEmoji(m.yontem)} ${esc(m.yontem)}</span><b>${fmtTRY(m.tutar)}</b></div>
                <div class="rep-bar-track"><div class="rep-bar-fill" style="width:${Math.max(4, (m.tutar / maxPay) * 100)}%"></div></div>
              </div>`).join("") || `<div class="rep-empty">— yok —</div>`}
          </div>
        </div>

        <div class="rep-sec">
          <div class="rep-sec-h"><span>🧮 Sayım Kontrolü</span><b class="${anyGer ? farkCls(totFark) : ""}">${anyGer ? "Fark " + fmtTRY(totFark) : "—"}</b></div>
          <div class="rep-check">
            <div class="rep-crow head"><span>Yöntem</span><span>Girilen</span><span>Gerçekleşen</span><span>Fark</span></div>
            ${sayim.map((m) => `
              <div class="rep-crow${m.fark ? " diff" : ""}">
                <span class="rep-cname">${gsPayEmoji(m.yontem)} ${esc(m.yontem)}</span>
                <span class="rep-cnum">${fmtNum(m.sis)}</span>
                <span class="rep-cnum">${m.hasGer ? fmtNum(m.ger) : "—"}</span>
                <span class="rep-cfark ${m.hasGer ? farkCls(m.fark) : ""}">${m.hasGer ? (m.fark === 0 ? "0,00" : fmtNum(m.fark)) : "—"}</span>
              </div>`).join("") || `<div class="rep-empty">— yok —</div>`}
            ${sayim.length ? `<div class="rep-crow total"><span class="rep-cname">Toplam</span><span class="rep-cnum">${fmtNum(totSis)}</span><span class="rep-cnum">${anyGer ? fmtNum(totGer) : "—"}</span><span class="rep-cfark ${anyGer ? farkCls(totFark) : ""}">${anyGer ? fmtNum(totFark) : "—"}</span></div>` : ""}
          </div>
          ${!anyGer ? `<div class="rep-empty" style="margin-top:6px">Bu gün için "Gerçekleşen (sayım)" tutarları girilmemiş.</div>` : ""}
        </div>

        <div class="rep-two">
          <div class="rep-sec green-sec">
            <div class="rep-sec-h"><span>🟢 Tahsilatlar</span><b>${fmtTRY(tahTot)}</b></div>
            ${liList(tahsilat, "sahis")}
          </div>
          <div class="rep-sec">
            <div class="rep-sec-h"><span>🧾 Veresiye Satış</span><b>${fmtTRY(cariTot)}</b></div>
            ${liList(cariIslem, "sahis")}
          </div>
        </div>

        <div class="rep-sec red-sec">
          <div class="rep-sec-h"><span>💸 Masraflar</span><b>${fmtTRY(masTot)}</b></div>
          ${liList(masraflar, "ad")}
        </div>

        <div class="rep-foot">Güllüoğlu Kübban · ${fmtDate(rec.date)} · Bu rapor uygulamadan üretilmiştir.</div>
      </div>

      <div class="card rep-noprint" style="margin-top:16px">
        <div class="card-head"><h3>📝 Notlar</h3></div>
        <div class="note-list">${notes.length ? notes.map((n) => `<div class="note"><div class="meta">${esc(n.by || "")} · ${esc(n.at || "")}</div>${esc(n.text)}</div>`).join("") : `<div class="empty" style="padding:16px"><p>Not yok.</p></div>`}</div>
        <div class="field" style="margin-top:12px"><label>Yeni Not</label><textarea id="note-text" rows="2" placeholder="Bu gün için not..."></textarea></div>
        <button class="btn btn-primary btn-sm" id="note-add">Not Ekle</button>
      </div>`;

    $("#rep-print", body).onclick = () => window.print();
    $("#note-add", body).onclick = async () => {
      const text = $("#note-text", body).value.trim();
      if (!text) return;
      const newNotes = [...notes, { text, by: currentUser.displayName || currentUser.email, at: new Date().toLocaleString("tr-TR") }];
      await updateDoc(doc(db, "dayEndRecords", rec.id), { notes: newNotes });
      rec.notes = newNotes;
      toast("Not eklendi.", "ok");
      renderReport(rec);
    };
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

// Hesap için dekoratif emoji (marka → kod → tür sırasıyla)
function accEmoji(a) {
  const code = String(a.code || "");
  const name = normTr(a.name || "");
  if (name.includes("yemek sepeti")) return "🍽️";
  if (name.includes("getir")) return "🛵";
  if (name.includes("trendyol")) return "🛒";
  if (name.includes("garanti")) return "🟢";
  if (name.includes("finans")) return "🔵";
  if (name.includes("ziraat")) return "🌾";
  if (name.includes("edenred") || name.includes("ticket")) return "🎟️";
  if (name.includes("multinet")) return "💠";
  if (name.includes("pluxee") || name.includes("sodex")) return "🍔";
  if (name.includes("metropol")) return "🏙️";
  if (name.includes("set kurumsal")) return "🏢";
  if (code.startsWith("100")) return "💵";
  if (code.startsWith("102")) return "🏦";
  if (code.startsWith("108")) return "🔒";
  if (code.startsWith("120")) return "👥";
  if (code.startsWith("320")) return "🚚";
  const t = a.type;
  if (t === "kasa") return "💵";
  if (t === "banka") return "🏦";
  if (t === "musteri") return "👥";
  if (t === "tedarikci") return "🚚";
  if (t === "gider") return "🧾";
  return "📁";
}

// Hesap bakiyelerini hareketlerden OTOMATİK hesapla:
//   güncel = açılış bakiyesi + hesap hareketleri + cari + banka
//   · hesap hareketleri (accountEntries): giren − çıkan, accountId'ye göre
//   · cari hareketler hesap KODUNA göre eşlenir (borç − alacak)
//   · banka hareketleri, Banka İşleme'de seçilen hedef hesabın id'sine göre eşlenir
function computeBalances(accounts, cari = [], bank = [], entries = []) {
  const map = new Map();
  const byCode = new Map();
  accounts.forEach((a) => {
    const opening = a.openingBalance != null ? a.openingBalance : (a.balance || 0);
    map.set(a.id, { opening, delta: 0, current: opening });
    if (a.code) byCode.set(String(a.code).trim(), a.id);
  });
  entries.forEach((e) => {
    if (e.accountId && map.has(e.accountId))
      map.get(e.accountId).delta +=
        parseNum(e.giren) - parseNum(e.cikan) + parseNum(e.borc) - parseNum(e.alacak);
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

// Kübban için önerilen varsayılan hesap planı (ana hesap + alt hesaplar)
const DEFAULT_CHART = [
  { code: "100", name: "Kasa Hesabı", type: "kasa" },
  { code: "102", name: "Banka Hesabı", type: "banka", subs: [
    { code: "102.01", name: "Garanti Banka Hesabı" },
    { code: "102.02", name: "Türkiye Finans Bankası Hesabı" },
    { code: "102.03", name: "Ziraat Bankası Hesabı" },
  ]},
  { code: "108", name: "Blokeli Hesaplar", type: "diger", subs: [
    { code: "108.01", name: "Garanti Bankası Bloke Hesabı" },
    { code: "108.02", name: "Türkiye Finans Bloke Hesabı" },
    { code: "108.03", name: "Yemek Sepeti" },
    { code: "108.04", name: "Getir Yemek" },
    { code: "108.05", name: "Trendyol" },
    { code: "108.06", name: "Edenred" },
    { code: "108.07", name: "Multinet" },
    { code: "108.08", name: "Pluxee" },
    { code: "108.09", name: "Metropol" },
    { code: "108.10", name: "Set Kurumsal" },
  ]},
  { code: "120", name: "Alıcı Hesaplar (Müşteriler)", type: "musteri" },
  { code: "320", name: "Tedarikçiler", type: "tedarikci" },
];
// Idempotent: yalnızca eksik olan varsayılan hesapları ekler (mevcutları korur)
async function seedDefaultChart() {
  const existing = await fetchAll(C.accounts).catch(() => []);
  const byCode = new Map(existing.map((a) => [String(a.code), a]));
  let added = 0;
  for (const m of DEFAULT_CHART) {
    let mainAcc = byCode.get(m.code);
    if (!mainAcc) {
      const ref = await addDoc(C.accounts(), {
        code: m.code, name: m.name, type: m.type, parentId: null, parentCode: null,
        openingBalance: 0, createdAt: serverTimestamp(),
      });
      mainAcc = { id: ref.id, code: m.code, type: m.type };
      byCode.set(m.code, mainAcc); added++;
    }
    for (const s of (m.subs || [])) {
      if (byCode.has(s.code)) continue;
      const ref = await addDoc(C.accounts(), {
        code: s.code, name: s.name, type: m.type, parentId: mainAcc.id, parentCode: m.code,
        openingBalance: 0, createdAt: serverTimestamp(),
      });
      byCode.set(s.code, { id: ref.id }); added++;
    }
  }
  return added;
}

async function viewHesaplar(c) {
  const [accounts, cari, bank, entries] = await Promise.all([
    fetchAll(C.accounts),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
    fetchAll(C.accountEntries).catch(() => []),
  ]);
  const balances = computeBalances(accounts, cari, bank, entries);

  // Hiç hesap yoksa: varsayılan planı öner
  if (!accounts.length) {
    c.innerHTML = `
      <div class="card">
        <div class="card-head"><h3>Hesap Planı</h3></div>
        <div class="empty">
          <div class="ico">💼</div>
          <p>Henüz hesap yok. Kübban için önerilen hesap planını tek tıkla oluşturabilir<br>ya da kendiniz başlayabilirsiniz.</p>
          <div class="toolbar" style="justify-content:center;margin-top:10px">
            <button class="btn btn-primary" id="seed">✨ Varsayılan Hesap Planını Oluştur</button>
            <button class="btn" id="manual">+ Boş Başla</button>
          </div>
          <div style="font-size:12px;color:var(--ink-faint);margin-top:10px">
            100 Kasa · 102 Banka (Garanti, Türkiye Finans, Ziraat) · 108 Blokeli · 120 Alıcılar · 320 Tedarikçiler
          </div>
        </div>
      </div>`;
    $("#seed").onclick = async () => {
      $("#seed").disabled = true;
      try { await seedDefaultChart(); toast("Hesap planı oluşturuldu.", "ok"); route(); }
      catch (e) { toast("Hata: " + e.message, "err"); $("#seed").disabled = false; }
    };
    $("#manual").onclick = () => accModal(null, null);
    return;
  }

  // Ağaç kur (ana hesap → alt hesap)
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const kids = new Map();
  const roots = [];
  accounts.forEach((a) => {
    if (a.parentId && byId.has(a.parentId)) {
      if (!kids.has(a.parentId)) kids.set(a.parentId, []);
      kids.get(a.parentId).push(a);
    } else roots.push(a);
  });
  const byCode = (x, y) =>
    String(x.code || "").localeCompare(String(y.code || ""), undefined, { numeric: true });
  const cur = (a) => balances.get(a.id)?.current || 0;
  roots.sort(byCode);
  // Alt hesaplar bakiyeye göre (işaretli). 320/336 küçükten büyüğe (en büyük borç üstte),
  // diğerleri büyükten küçüğe. Eşitse koda göre.
  kids.forEach((arr, pid) => {
    const pc = String(byId.get(pid)?.code || "");
    const asc = pc === "320" || pc === "336";
    arr.sort((x, y) => (asc ? cur(x) - cur(y) : cur(y) - cur(x)) || byCode(x, y));
  });
  const rolled = (a) => (kids.get(a.id) || []).reduce((s, ch) => s + rolled(ch), cur(a));
  const grand = roots.reduce((s, a) => s + rolled(a), 0);

  const childCount = (a) => (kids.get(a.id) || []).length;

  const rowHtml = (a, sub) => {
    const parent = !sub && childCount(a) > 0;
    const bal = sub ? cur(a) : rolled(a);
    const cls = sub ? "sub" : (parent ? "parent" : "leaf");
    return `<div class="acc-row ${cls}" data-id="${a.id}"${sub ? ` data-parent="${a.parentId}" style="display:none"` : ""}>
      <span class="chev">${parent ? "▸" : ""}</span>
      <span class="acc-ico${sub ? " blank" : ""}">${sub ? "" : accEmoji(a)}</span>
      <div class="info">
        <span class="code">${esc(a.code || "—")}</span>
        <span class="name">${esc(a.name || "")}${parent ? ` <em>(${childCount(a)} alt)</em>` : ""}</span>
      </div>
      <span class="bal" style="color:${bal<0?'var(--danger)':'inherit'}">${fmtTRY(bal)}</span>
      <span class="acts">
        <span class="slot go" aria-hidden="true">${parent ? "" : "›"}</span>
        <span class="slot add">${parent ? `<button class="ic" data-addsub="${a.id}" title="Alt hesap ekle">＋</button>` : ""}</span>
        <span class="slot edit"><button class="ic" data-edit="${a.id}" title="Düzenle">✎</button></span>
      </span>
    </div>`;
  };
  const renderMain = (a) =>
    rowHtml(a, false) + (kids.get(a.id) || []).map((s) => rowHtml(s, true)).join("");

  const subCount = accounts.length - roots.length;
  c.innerHTML = `
    <div class="acc-hero">
      <div class="acc-hero-ico">💼</div>
      <div class="acc-hero-main">
        <div class="acc-hero-label">Genel Toplam</div>
        <div class="acc-hero-total" style="${grand < 0 ? "color:#ffd9d0" : ""}">${fmtTRY(grand)}</div>
        <div class="acc-hero-sub">🗂️ ${roots.length} ana hesap · 🧾 ${accounts.length} hesap${subCount ? ` · 🔖 ${subCount} alt` : ""}</div>
      </div>
    </div>
    <div class="toolbar acc-tools">
      <div class="acc-search">
        <input id="acc-q" type="search" autocomplete="off" placeholder="🔍 Hesap ara — ör. 'Ga' → Garanti Bankası" />
        <div class="acc-suggest" id="acc-suggest"></div>
      </div>
      <button class="btn btn-sm" id="acc-import">📥 Toplu Cari</button>
      <button class="btn btn-sm" id="acc-kasa" style="display:none">📒 Kasa Geçmişi</button>
      <button class="btn btn-sm" id="acc-banka" style="display:none">🏦 Banka Geçmişi</button>
      <button class="btn btn-sm" id="acc-carigec" style="display:none">🧾 Cari Geçmişi</button>
      <button class="btn btn-sm" id="acc-complete" style="display:none">⤓ Varsayılanları Tamamla</button>
      <button class="btn btn-sm" id="acc-add" style="display:none">＋ Yeni Hesap</button>
      <button class="btn btn-sm btn-danger" id="acc-clean" style="display:none">🧹 Grup Temizle</button>
    </div>
    <div class="card" id="acc-plan-card" style="padding:0;overflow:hidden">
      <div class="acc-plan-head">
        <span class="ttl">📋 Hesap Planı</span>
        <span class="acc-plan-right">
          <span class="hint">${roots.length} ana hesap</span>
          <button class="acc-edit-ic" id="edit-toggle" title="Hesapları Düzenle">✏️</button>
        </span>
      </div>
      <div class="acc-list">${roots.map(renderMain).join("")}</div>
    </div>`;

  const setOpen = (id, open) => {
    $$(`.acc-row.sub[data-parent="${id}"]`, c).forEach((r) => r.style.display = open ? "flex" : "none");
    const main = $(`.acc-row.parent[data-id="${id}"]`, c);
    if (main) {
      main.dataset.open = open ? "1" : "0";
      const t = $(".chev", main);
      if (t) t.textContent = open ? "▾" : "▸";
    }
  };
  // Alt hesaplar varsayılan KAPALI başlar

  $$(".acc-row.parent", c).forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      setOpen(row.dataset.id, row.dataset.open !== "1");
    });
  });
  $$(".acc-row.leaf, .acc-row.sub", c).forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      location.hash = "#/hesap-detay?id=" + row.dataset.id;
    });
  });
  // Hesap arama + tahmin (autocomplete). Enter → o hesabın hareketlerine git.
  const flat = accounts.map((a) => ({
    id: a.id, code: String(a.code || ""), name: a.name || "", emoji: accEmoji(a),
    normName: normTr(a.name || ""), norm: normTr((a.code || "") + " " + (a.name || "")),
  }));
  const searchAccounts = (q) => {
    const nq = normTr(q);
    if (!nq) return [];
    const starts = [], contains = [];
    flat.forEach((f) => {
      if (f.normName.startsWith(nq) || f.code.toLowerCase().startsWith(nq)) starts.push(f);
      else if (f.norm.includes(nq)) contains.push(f);
    });
    return [...starts, ...contains].slice(0, 8);
  };
  const sug = { items: [], active: 0 };
  const qInp = $("#acc-q", c), sugBox = $("#acc-suggest", c);
  const setBlur = (on) => $("#acc-plan-card", c)?.classList.toggle("blurred", on);
  const closeSuggest = () => { sugBox.classList.remove("open"); setBlur(false); };
  const go = (id) => { if (id) { closeSuggest(); location.hash = "#/hesap-detay?id=" + id; } };
  const paintActive = () => $$(".sug", sugBox).forEach((el, i) => {
    el.classList.toggle("active", i === sug.active);
    if (i === sug.active) el.scrollIntoView({ block: "nearest" });
  });
  const renderSuggest = () => {
    sug.items = searchAccounts(qInp.value); sug.active = 0;
    if (!sug.items.length) { sugBox.innerHTML = ""; closeSuggest(); return; }
    sugBox.innerHTML = sug.items.map((f, i) => `
      <div class="sug ${i === 0 ? "active" : ""}" data-id="${f.id}">
        <span class="sug-code">${esc(f.code)}</span>
        <span class="sug-name">${esc(f.name)}</span>
      </div>`).join("");
    sugBox.classList.add("open"); setBlur(true);
    $$(".sug", sugBox).forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); go(el.dataset.id); }));
  };
  qInp.addEventListener("input", renderSuggest);
  qInp.addEventListener("focus", renderSuggest);
  qInp.addEventListener("blur", () => setTimeout(closeSuggest, 150));
  qInp.addEventListener("keydown", (e) => {
    const n = sug.items.length;
    if (e.key === "ArrowDown") { e.preventDefault(); if (n) { sug.active = (sug.active + 1) % n; paintActive(); } }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (n) { sug.active = (sug.active - 1 + n) % n; paintActive(); } }
    else if (e.key === "Enter") { e.preventDefault(); const f = sug.items[sug.active] || sug.items[0]; if (f) go(f.id); }
    else if (e.key === "Escape") { closeSuggest(); qInp.blur(); }
  });
  // Üstteki "Yeni Hesap": önce Ana/Alt, Alt ise hangi ana hesabın altında
  const openNewChooser = () => {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="field"><label>Hesap Türü</label>
        <select id="nk-kind">
          <option value="main">Ana Hesap</option>
          <option value="sub">Alt Hesap</option>
        </select>
      </div>
      <div class="field" id="nk-parent-wrap" style="display:none">
        <label>Hangi Ana Hesabın Altında?</label>
        <select id="nk-parent">
          ${roots.map((r) => `<option value="${r.id}">${esc((r.code || "") + " · " + r.name)}</option>`).join("")}
        </select>
      </div>`;
    const m = openModal({
      title: "Yeni Hesap",
      body,
      footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Devam", "btn-primary", () => {
          const kind = $("#nk-kind", body).value;
          m.close();
          if (kind === "main") { accModal(null, null); return; }
          const p = byId.get($("#nk-parent", body).value);
          if (!p) return toast("Önce bir ana hesap seçin.", "err");
          accModal(null, p, { nextCode: nextSubCode(p, kids.get(p.id) || []) });
        }),
      ],
    });
    $("#nk-kind", body).onchange = (e) =>
      $("#nk-parent-wrap", body).style.display = e.target.value === "sub" ? "" : "none";
  };

  $("#acc-add").onclick = openNewChooser;
  $("#acc-import").onclick = () => { location.hash = "#/cari-import"; };
  const kasaBtn = $("#acc-kasa", c);
  if (kasaBtn) { if (isAdmin()) kasaBtn.style.display = ""; kasaBtn.onclick = () => { location.hash = "#/kasa-import"; }; }
  const bankaBtn = $("#acc-banka", c);
  if (bankaBtn) { if (isAdmin()) bankaBtn.style.display = ""; bankaBtn.onclick = () => { location.hash = "#/banka-import"; }; }
  const cariGecBtn = $("#acc-carigec", c);
  if (cariGecBtn) { if (isAdmin()) cariGecBtn.style.display = ""; cariGecBtn.onclick = () => { location.hash = "#/cari-gecmis-import"; }; }
  // "Hesapları Düzenle" modu: düzenle/alt ekle ikonları görünür olur
  $("#edit-toggle").onclick = () => {
    const list = $(".acc-list", c);
    const on = list.classList.toggle("edit-mode");
    const btn = $("#edit-toggle", c);
    btn.textContent = on ? "✓" : "✏️";
    btn.title = on ? "Düzenlemeyi Bitir" : "Hesapları Düzenle";
    btn.classList.toggle("active", on);
    $("#acc-add", c).style.display = on ? "" : "none";
    $("#acc-complete", c).style.display = on ? "" : "none";
    const cl = $("#acc-clean", c);
    if (cl) cl.style.display = (on && isAdmin()) ? "" : "none";
  };
  const cleanBtn = $("#acc-clean", c);
  if (cleanBtn) cleanBtn.onclick = () => groupCleanModal(accounts, cari, bank, entries);
  $("#acc-complete").onclick = () =>
    confirmDialog("Eksik varsayılan hesaplar (ör. 108 bloke alt hesapları) eklensin mi? Mevcut hesaplar korunur.", async () => {
      try {
        const n = await seedDefaultChart();
        toast(n ? `${n} varsayılan hesap eklendi.` : "Eklenecek eksik hesap yok.", "ok");
        route();
      } catch (e) { toast("Hata: " + e.message, "err"); }
    });
  $$("[data-addsub]", c).forEach((b) => b.onclick = () => {
    const p = byId.get(b.dataset.addsub);
    accModal(null, p, { nextCode: nextSubCode(p, kids.get(p.id) || []) });
  });
  $$("[data-edit]", c).forEach((b) => b.onclick = () => {
    const a = byId.get(b.dataset.edit);
    accModal(a, a.parentId ? byId.get(a.parentId) : null, { children: kids.get(a.id) || [] });
  });
}

// 🧹 Grup Temizle — bir ana hesap grubunun (ör. 320 / 120 / 128) verilerini siler.
//   Mod A: grubun ALT hesaplarını + tüm hareketlerini siler (ana başlık kalır)
//   Mod B: hesaplar kalır, sadece hareketleri siler + açılış bakiyeleri 0'lanır
//   Hareketler 4 yerde: accountEntries (accountId), currentMovements (code),
//   bankTransactions (accountId).
function groupCleanModal(accounts, cari = [], bank = [], entries = []) {
  if (!isAdmin()) return toast("Bu işlem yalnızca yönetici içindir.", "err");
  const kidsByParent = new Map();
  accounts.forEach((a) => {
    if (a.parentId) {
      if (!kidsByParent.has(a.parentId)) kidsByParent.set(a.parentId, []);
      kidsByParent.get(a.parentId).push(a);
    }
  });
  const roots = accounts.filter((a) => !a.parentId)
    .sort((x, y) => String(x.code || "").localeCompare(String(y.code || ""), "tr"));

  // Grup istatistikleri
  const stat = (root) => {
    const children = kidsByParent.get(root.id) || [];
    const groupAccts = [root, ...children];
    const ids = new Set(groupAccts.map((a) => a.id));
    const codes = new Set(groupAccts.map((a) => String(a.code || "").trim()).filter(Boolean));
    const nEntry = entries.filter((e) => ids.has(e.accountId)).length;
    const nCur = cari.filter((m) => codes.has(String(m.code || "").trim())).length;
    const nBank = bank.filter((t) => ids.has(t.accountId)).length;
    return { root, children, ids, codes, nChild: children.length, nMov: nEntry + nCur + nBank };
  };
  const stats = roots.map(stat).filter((s) => s.nChild > 0 || s.nMov > 0);
  if (!stats.length) return toast("Temizlenecek grup yok.", "err");

  const rowHtml = (s) => `
    <label class="gc-row">
      <input type="checkbox" class="gc-ck" data-id="${s.root.id}" />
      <span class="gc-code">${esc(s.root.code || "—")}</span>
      <span class="gc-name">${esc(s.root.name || "")}</span>
      <span class="gc-meta">${s.nChild} hesap · ${s.nMov.toLocaleString("tr-TR")} hareket</span>
    </label>`;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="gc-note">Seçtiğin grupların verilerini siler. <b>Geri alınamaz.</b></div>
    <div class="gc-list">${stats.map(rowHtml).join("")}</div>
    <div class="gc-modes">
      <label class="gc-mode"><input type="radio" name="gc-mode" value="A" checked />
        <span><b>Hesapları ve hareketlerini sil</b><small>Alt hesaplar (ör. cariler) tamamen silinir; ana başlık (${esc(stats.map((s) => s.root.code).join(", "))}) kalır. Yeniden içe aktarmadan önce ideal.</small></span></label>
      <label class="gc-mode"><input type="radio" name="gc-mode" value="B" />
        <span><b>Sadece hareketleri sil</b><small>Hesaplar (isimler) kalır; borç/alacak hareketleri silinir ve açılış bakiyeleri 0'lanır.</small></span></label>
    </div>`;

  const m = openModal({
    title: "🧹 Grup Temizle",
    body: wrap,
    footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Temizle", "btn-danger", () => {
        const picked = $$(".gc-ck", wrap).filter((ck) => ck.checked).map((ck) => ck.dataset.id);
        if (!picked.length) return toast("En az bir grup seç.", "err");
        const mode = ($("input[name='gc-mode']:checked", wrap) || {}).value || "A";
        const chosen = stats.filter((s) => picked.includes(s.root.id));
        const sumChild = chosen.reduce((n, s) => n + s.nChild, 0);
        const sumMov = chosen.reduce((n, s) => n + s.nMov, 0);
        const codesTxt = chosen.map((s) => s.root.code).join(", ");
        const msg = mode === "A"
          ? `${codesTxt} — ${sumChild} alt hesap ve ${sumMov.toLocaleString("tr-TR")} hareket SİLİNECEK (ana başlıklar kalır). Emin misin?`
          : `${codesTxt} — ${sumMov.toLocaleString("tr-TR")} hareket silinecek, açılış bakiyeleri 0'lanacak (hesaplar kalır). Emin misin?`;
        m.close();
        confirmDialog(msg, () => runGroupClean(chosen, mode));
      }),
    ],
  });
}

async function runGroupClean(chosen, mode) {
  const lb = loadingBar("Temizleniyor…");
  try {
    const delOps = [];
    // Taze veri çek (önbellek eskimişse doğru id'lerle sil)
    const [freshEntries, freshCur, freshBank] = await Promise.all([
      fetchAll(C.accountEntries).catch(() => []),
      fetchAll(C.currentMovements).catch(() => []),
      fetchAll(C.bankTransactions).catch(() => []),
    ]);
    const allIds = new Set(), allCodes = new Set();
    const acctDelIds = [], acctZeroIds = [];
    for (const s of chosen) {
      s.ids.forEach((id) => allIds.add(id));
      s.codes.forEach((cd) => allCodes.add(cd));
      if (mode === "A") s.children.forEach((ch) => acctDelIds.push(ch.id));
      else [s.root, ...s.children].forEach((a) => acctZeroIds.push(a.id));
    }
    freshEntries.forEach((e) => { if (allIds.has(e.accountId)) delOps.push(["accountEntries", e.id]); });
    freshCur.forEach((mv) => { if (allCodes.has(String(mv.code || "").trim())) delOps.push(["currentMovements", mv.id]); });
    freshBank.forEach((t) => { if (allIds.has(t.accountId)) delOps.push(["bankTransactions", t.id]); });
    if (mode === "A") acctDelIds.forEach((id) => delOps.push(["accounts", id]));

    for (let i = 0; i < delOps.length; i += 400) {
      const b = writeBatch(db);
      delOps.slice(i, i + 400).forEach(([coll, id]) => b.delete(doc(db, coll, id)));
      await b.commit();
    }
    if (mode === "B") {
      for (let i = 0; i < acctZeroIds.length; i += 400) {
        const b = writeBatch(db);
        acctZeroIds.slice(i, i + 400).forEach((id) => b.update(doc(db, "accounts", id), { openingBalance: 0 }));
        await b.commit();
      }
    }
    const codesTxt = chosen.map((s) => s.root.code).join(", ");
    await logAction("Temizleme", "Hesap Grubu", `${codesTxt} · ${mode === "A" ? "hesap+hareket" : "sadece hareket"} · ${delOps.length} kayıt`);
    lb.finish(() => {
      toast(`${codesTxt} temizlendi (${delOps.length.toLocaleString("tr-TR")} kayıt silindi).`, "ok");
      route();
    });
  } catch (e) { lb.finish(); toast("Hata: " + e.message, "err"); }
}

// Bir ana hesabın bir sonraki alt hesap kodunu üretir (102.03 sonrası 102.04)
function nextSubCode(parent, siblings) {
  const prefix = (parent.code || "") + ".";
  let max = 0;
  (siblings || []).forEach((s) => {
    const rest = String(s.code || "").startsWith(prefix) ? s.code.slice(prefix.length) : "";
    const n = parseInt(rest, 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + String(max + 1).padStart(2, "0");
}

// accModal(acc, parent, opts):
//   yeni ana hesap  → acc=null, parent=null
//   yeni alt hesap  → acc=null, parent=<ana hesap>, opts.nextCode=<otomatik kod>
//   düzenleme       → acc=<hesap>, parent=<üst hesap ya da null>
function accModal(acc, parent, opts) {
  const isNew = !acc;
  const isSub = !!parent || !!(acc && acc.parentId);
  const fixedType = isSub ? (parent?.type || acc?.type) : null;
  const codeDefault = isNew && parent ? (opts?.nextCode || (parent.code + ".01")) : (acc?.code || "");
  const body = document.createElement("div");
  body.innerHTML = `
    ${isSub ? `<div class="notice info" style="margin-bottom:14px">Alt hesap${
      parent ? " · Üst hesap: <b>" + esc((parent.code || "") + " " + parent.name) + "</b>"
             : (acc?.parentCode ? " · Üst hesap: <b>" + esc(acc.parentCode) + "</b>" : "")}</div>` : ""}
    <div class="form-row">
      <div class="field"><label>Hesap Kodu</label><input id="a-code" value="${esc(codeDefault)}" placeholder="${isSub ? (parent?.code || "102") + ".01" : "100"}" /></div>
      <div class="field"><label>Tür</label>
        ${isSub
          ? `<input value="${esc(accTypeLabel(fixedType))}" disabled /><input type="hidden" id="a-type" value="${esc(fixedType)}" />`
          : `<select id="a-type">${ACCOUNT_TYPES.map((t) => `<option value="${t.value}" ${acc?.type===t.value?"selected":""}>${t.label}</option>`).join("")}</select>`}
      </div>
    </div>
    <div class="field"><label>Hesap Adı</label><input id="a-name" value="${esc(acc?.name || "")}" placeholder="${isSub ? "Garanti Banka Hesabı" : "Kasa Hesabı"}" /></div>
    <div class="field"><label>Açılış Bakiyesi (₺)</label><input id="a-balance" class="num" value="${acc?.openingBalance ?? acc?.balance ?? 0}" />
      <div style="font-size:11px;color:var(--ink-faint);margin-top:4px">Güncel bakiye, bu değere hareketler eklenerek otomatik hesaplanır.</div></div>`;
  const footer = [];
  // Düzenleme modunda Sil butonu (solda)
  if (!isNew) {
    const kids = opts?.children || [];
    const delBtn = mkBtn("🗑️ Sil", "btn-danger", () => {
      confirmDialog(
        kids.length ? `"${acc.name}" ve ${kids.length} alt hesabı silinsin mi?` : `"${acc.name}" silinsin mi?`,
        async () => {
          for (const s of kids) await deleteDoc(doc(db, "accounts", s.id));
          await deleteDoc(doc(db, "accounts", acc.id));
          await logAction("Silme", "Hesap", `${acc.code || ""} ${acc.name || ""}`);
          m.close(); toast("Silindi.", "ok"); route();
        });
    });
    delBtn.style.marginRight = "auto"; // sola yasla
    footer.push(delBtn);
  }
  footer.push(mkBtn("Vazgeç", "", () => m.close()));
  footer.push(mkBtn("Kaydet", "btn-primary", async () => {
    const payload = {
      code: $("#a-code", body).value.trim(),
      name: $("#a-name", body).value.trim(),
      type: $("#a-type", body).value,
      openingBalance: parseNum($("#a-balance", body).value),
      updatedAt: serverTimestamp(),
    };
    if (isNew) {
      payload.parentId = parent ? parent.id : null;
      payload.parentCode = parent ? parent.code : null;
    }
    if (!payload.name) return toast("Hesap adı gerekli.", "err");
    try {
      if (isNew) {
        await addDoc(C.accounts(), { ...payload, createdAt: serverTimestamp() });
        await logAction("Ekleme", "Hesap", `${payload.code || ""} ${payload.name}`);
      } else {
        await updateDoc(doc(db, "accounts", acc.id), payload);
        await logAction("Düzenleme", "Hesap", `${payload.code || ""} ${payload.name}`);
      }
      m.close(); toast("Kaydedildi.", "ok"); route();
    } catch (e) { toast("Hata: " + e.message, "err"); }
  }));
  const m = openModal({
    title: isNew ? (parent ? "Alt Hesap Ekle" : "Yeni Ana Hesap") : "Hesabı Düzenle",
    body,
    footer,
  });
}

// ===========================================================================
//  MODÜL: HESAP HAREKET DEFTERİ (iç yapı) — Kasa vb.
//  Kolonlar: İşlem No · Tarih · İşlem Adı · Şahıs · Açıklama · Rapor
//            Giren Tutar · Çıkan Tutar · Güncel Bakiye
// ===========================================================================
function hashQuery(key) {
  const q = location.hash.split("?")[1] || "";
  return new URLSearchParams(q).get(key);
}

// Cari hesap mı? (320 Tedarikçi / 120 Müşteri) → Borç/Alacak + Fatura defteri
function isCari(type) { return type === "musteri" || type === "tedarikci"; }
const FATURA_TURU = ["", "Satış Faturası", "Alış Faturası", "İade Faturası", "Proforma", "İrsaliye", "Diğer"];

// ===========================================================================
//  MODÜL: TOPLU CARİ İÇE AKTAR (Excel/CSV → hesaplar + açılış bakiyeleri)
// ===========================================================================
// Hesap türü → { ana kod, ad, tip, işaret }. İşaret: borçlu olduğun (320/336)
// → açılış negatif (alacak bakiye); alacaklı (120) → pozitif (borç bakiye).
// Dosya bakiyesi tek biçimli: (+) = Alacak, (−) = Borç → açılış = −bakiye (tüm türler).
const CI_TUR = {
  "320": { code: "320", name: "Tedarikçiler", type: "tedarikci", sign: -1 },
  "321": { code: "321", name: "Tanımlanmamış Cariler", type: "tedarikci", sign: -1 },
  "335": { code: "335", name: "Personele Borçlar", type: "tedarikci", sign: -1 },
  "336": { code: "336", name: "Diğer Çeşitli Borçlar", type: "tedarikci", sign: -1 },
  "120": { code: "120", name: "Alıcılar (Müşteriler)", type: "musteri", sign: -1 },
  "121": { code: "121", name: "Alacak Senetleri", type: "musteri", sign: -1 },
  "128": { code: "128", name: "Şüpheli Ticari Alacaklar", type: "musteri", sign: -1 },
};
// Hesap türü çözümleyici: bilinenler CI_TUR'dan; 108 → blokeli, 1xx → müşteri,
// 3xx → tedarikçi, diğer tüm 3 haneli kodlar → diğer. Yalnızca GEÇERLİ HESAP KODU
// yoksa (3 haneli sayı bulunamıyorsa) satır atlanır.
function ciCfg(tur) {
  if (CI_TUR[tur]) return CI_TUR[tur];
  if (!/^\d{3}$/.test(tur)) return null;
  if (tur === "108") return { code: "108", name: "Blokeli Hesaplar", type: "diger", sign: -1 };
  if (tur[0] === "1") return { code: tur, name: `Alacaklar (${tur})`, type: "musteri", sign: -1 };
  if (tur[0] === "3") return { code: tur, name: `Borçlar (${tur})`, type: "tedarikci", sign: -1 };
  return { code: tur, name: `Hesap (${tur})`, type: "diger", sign: -1 };
}
function ciParseBal(v) {
  if (typeof v === "number") return v;
  let s = String(v || "").replace(/[₺\s]/g, "");
  const neg = /^-/.test(s) || /-$/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : (neg ? -Math.abs(n) : n);
}

async function viewCariImport(c) {
  let accounts = await fetchAll(C.accounts).catch(() => []);
  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>📥 Toplu Cari İçe Aktar</h3><a class="btn btn-sm" href="#/hesaplar">← Hesaplar</a></div>
      <div class="pv-fhint">Excel/CSV yükle — sütunlar: <b>Cari No · Cari Adı · Hesap Türü</b> (Bakiye alınmaz).<br>
        <b>Tüm cariler</b> oluşturulur (108 dahil); <b>Hesap Türü boş olanlar</b> da seçtiğin grup altında açılır (varsayılan 320). Açılış bakiyesi <b>0</b> — bakiye, hesap hareketlerinden hesaplanır.</div>
      <div id="ci-drop" style="margin-top:12px"></div>
    </div>
    <div id="ci-editor"></div>`;

  $("#ci-drop").appendChild(fileDrop(async (file) => {
    const lb = loadingBar("Dosya okunuyor…");
    try {
      const { headers, rows } = await parseSpreadsheet(file);
      if (!rows.length) { lb.finish(); return toast("Veri bulunamadı.", "err"); }
      lb.finish(() => build(headers, rows));
    } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
  }, ".xlsx,.xls,.csv", true));

  function build(headers, rows) {
    const col = {
      no: guessCol(headers, ["cari no", "carino", "cari kod", "kod"]),
      ad: guessCol(headers, ["cari ad", "cari ünvan", "cari unvan", "ünvan", "unvan", "ad"]),
      bakiye: guessCol(headers, ["bakiye", "tutar"]),
      tur: guessCol(headers, ["hesap tür", "hesap tur", "tür", "tur"]),
    };
    if (!col.ad) return toast("'Cari Adı' sütunu bulunamadı.", "err");

    const items = [], blank = [];
    rows.forEach((r) => {
      const ad = String(r[col.ad] ?? "").trim();
      if (!ad) return;
      const turRaw = String(r[col.tur] ?? "").trim();
      const tur = (turRaw.match(/\d{3}/) || [])[0] || turRaw;
      const cfg = ciCfg(tur);
      const no = String(r[col.no] ?? "").trim();
      const bakiye = ciParseBal(r[col.bakiye]);
      if (!cfg) { blank.push({ no, ad, bakiye }); return; }   // Hesap Türü boş → ayrı kova
      items.push({ no, ad, bakiye, tur, cfg });
    });
    if (!items.length && !blank.length) return toast("İşlenecek cari bulunamadı — 'Cari Adı' sütunu dolu olmalı.", "err");

    // Mevcut eşleştirme: aynı ana kod altında extNo ya da ada göre
    const findExisting = (it) => {
      const list = accounts.filter((a) => a.parentCode === it.cfg.code);
      return list.find((a) => a.extNo && it.no && String(a.extNo) === it.no)
          || list.find((a) => normTr(a.name) === normTr(it.ad)) || null;
    };
    // Bakiye ALINMIYOR — açılış hep 0 (güncel bakiye hesap hareketlerinden hesaplanır)
    items.forEach((it) => { it.exist = findExisting(it); it.opening = 0; });

    const yeni = items.filter((it) => !it.exist).length;
    const guncelle = items.length - yeni;
    const byTur = {};
    items.forEach((it) => { byTur[it.tur] = (byTur[it.tur] || 0) + 1; });
    const turOzet = Object.entries(byTur).map(([t, n]) => `${t}: ${n}`).join(" · ");
    const GROUPS = [["321", "321 Tanımlanmamış Cariler"], ["320", "320 Tedarikçiler"], ["120", "120 Müşteriler"],
      ["336", "336 Diğer Borçlar"], ["335", "335 Personele Borçlar"], ["128", "128 Şüpheli Alacaklar"], ["108", "108 Bloke"]];

    const editor = $("#ci-editor");
    editor.innerHTML = `
      <div class="card">
        <div class="pv-head"><div class="pv-title">${(items.length + blank.length).toLocaleString("tr-TR")} cari okundu</div>
          <div class="pv-sub">${yeni} yeni · ${guncelle} mevcut · ${turOzet}${blank.length ? ` · ${blank.length} kodsuz` : ""}</div></div>
        ${blank.length ? `<div class="notice warn" style="margin-bottom:10px">⚠️ <b>${blank.length.toLocaleString("tr-TR")}</b> carinin Hesap Türü boş (ör. ${esc(blank.slice(0, 4).map((b) => b.ad).join(", "))}…).
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="ci-inclblank" checked style="width:16px;height:16px;accent-color:var(--gold)"> <b>Kodsuzları da aç</b> (hepsi oluşsun)</label>
            <span style="color:var(--ink-soft)">Grup:</span>
            <select id="ci-blankgrp">${GROUPS.map(([c, l]) => `<option value="${c}" ${c === "321" ? "selected" : ""}>${l}</option>`).join("")}</select>
          </div></div>` : ""}
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Cari No</th><th>Cari Adı</th><th>Tür</th><th class="num">Bakiye (alınmaz)</th><th>Durum</th></tr></thead>
          <tbody>${items.slice(0, 300).map((it) => `<tr>
            <td>${esc(it.no || "—")}</td>
            <td>${esc(it.ad)}</td>
            <td>${esc(it.tur)}</td>
            <td class="num" style="color:var(--ink-faint)">${fmtTRY(Math.abs(it.bakiye))}</td>
            <td>${it.exist ? '<span style="color:var(--gold-dark)">Var</span>' : "Yeni"}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${items.length > 300 ? `<div class="pv-fhint">İlk 300 (kodlu) satır gösteriliyor; hepsi işlenecek.</div>` : ""}
        <div class="pv-fhint">Açılış bakiyesi <b>0</b> olarak eklenir — güncel bakiye, hesap hareketleri yüklenince otomatik hesaplanır.</div>
      </div>
      <div class="pv-cta"><div class="grow"></div><button class="btn btn-primary" id="ci-save">✓ İçe Aktar</button></div>`;

    const inclBlank = () => !!$("#ci-inclblank", editor)?.checked;
    const totalToSave = () => items.length + (blank.length && inclBlank() ? blank.length : 0);
    const saveBtn = $("#ci-save", editor);
    const refresh = () => { saveBtn.textContent = `✓ ${totalToSave().toLocaleString("tr-TR")} Cariyi İçe Aktar`; };
    refresh();
    $("#ci-inclblank", editor)?.addEventListener("change", refresh);

    saveBtn.onclick = () => {
      const finalItems = items.slice();
      if (blank.length && inclBlank()) {
        const gc = $("#ci-blankgrp", editor)?.value || "321";
        const bcfg = ciCfg(gc) || CI_TUR["321"];
        blank.forEach((b) => { b.cfg = bcfg; b.tur = gc; b.exist = findExisting(b); b.opening = 0; finalItems.push(b); });
      }
      apply(finalItems, editor);
    };
  }

  async function apply(items, editor) {
    const btn = $("#ci-save", editor); btn.disabled = true;
    try {
      // Ana grupları hazırla (yoksa oluştur: 321/336 gibi)
      const ensureParent = async (cfg) => {
        let p = accounts.find((a) => String(a.code) === cfg.code && !a.parentId);
        if (p) return p;
        const ref = await addDoc(C.accounts(), { code: cfg.code, name: cfg.name, type: cfg.type, parentId: null, parentCode: null, openingBalance: 0, createdAt: serverTimestamp() });
        p = { id: ref.id, code: cfg.code, name: cfg.name, type: cfg.type, parentId: null };
        accounts.push(p);
        return p;
      };
      const parentByCode = {};
      for (const it of items) if (!parentByCode[it.cfg.code]) parentByCode[it.cfg.code] = await ensureParent(it.cfg);

      // Ana kod başına yerel sayaç (kod çakışmasın)
      const counter = {};
      const nextCode = (parentCode) => {
        if (counter[parentCode] == null)
          counter[parentCode] = accounts.filter((a) => a.parentCode === parentCode)
            .reduce((m, a) => { const n = parseInt(String(a.code || "").split(".")[1], 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
        counter[parentCode] += 1;
        return `${parentCode}.${String(counter[parentCode]).padStart(2, "0")}`;
      };

      // Yeni hesap payload'ları + mevcutlarda yalnızca extNo güncelle
      const newDocs = [], updates = [];
      let created = 0, updated = 0;
      for (const it of items) {
        if (it.exist) {
          if (it.no && String(it.exist.extNo || "") !== it.no) updates.push({ id: it.exist.id, extNo: it.no });
          updated++;
        } else {
          const parent = parentByCode[it.cfg.code];
          newDocs.push({ code: nextCode(it.cfg.code), name: titleCase(it.ad), type: it.cfg.type, parentId: parent.id, parentCode: it.cfg.code, vkn: "", extNo: it.no || "", openingBalance: 0, createdAt: serverTimestamp() });
          created++;
        }
      }

      // Toplu yaz (writeBatch, 400'lük parçalar) — 3600+ hesap için hızlı
      for (let i = 0; i < newDocs.length; i += 400) {
        const b = writeBatch(db);
        newDocs.slice(i, i + 400).forEach((d) => b.set(doc(C.accounts()), d));
        await b.commit();
        btn.textContent = `İşleniyor… ${Math.min(i + 400, newDocs.length).toLocaleString("tr-TR")}/${newDocs.length.toLocaleString("tr-TR")}`;
      }
      for (let i = 0; i < updates.length; i += 400) {
        const b = writeBatch(db);
        updates.slice(i, i + 400).forEach((u) => b.update(doc(db, "accounts", u.id), { extNo: u.extNo }));
        await b.commit();
      }

      // ── DOĞRULAMA: veritabanına gerçekten yazıldı mı? (veri kaybı kontrolü) ──
      const after = await fetchAll(C.accounts).catch(() => []);
      const afterNames = new Set(after.map((a) => normTr(a.name)));
      const missing = items.filter((it) => !afterNames.has(normTr(it.ad)));
      const leafCount = after.filter((a) => a.parentId).length;

      await logAction("İçe Aktarma", "Cari", `Toplu: ${created} yeni, ${updated} mevcut${missing.length ? ` · ⚠️ ${missing.length} eksik` : ""}`);
      const okAll = missing.length === 0;
      successAnim(`${created.toLocaleString("tr-TR")} yeni cari açıldı`);
      editor.innerHTML = `
        <div class="notice ${okAll ? "info" : "warn"}">
          ${okAll ? "✔" : "⚠️"} İçe aktarıldı: <b>${created.toLocaleString("tr-TR")}</b> yeni cari, <b>${updated.toLocaleString("tr-TR")}</b> zaten mevcut.
          <div style="margin-top:6px;font-size:13px">
            🔎 <b>Doğrulama:</b> ${items.length.toLocaleString("tr-TR")} cari işlendi ·
            veritabanında ${leafCount.toLocaleString("tr-TR")} alt hesap ·
            ${okAll ? "<b style='color:var(--ok)'>tüm isimler yazıldı, veri kaybı yok ✅</b>"
                    : `<b style='color:var(--danger)'>${missing.length} isim yazılamadı: ${esc(missing.slice(0, 5).map((m) => m.ad).join(", "))}…</b> — tekrar deneyin`}
          </div>
          <a href="#/hesaplar">← Hesaplara dön</a>
        </div>`;
    } catch (e) { toast("Hata: " + e.message, "err"); btn.disabled = false; }
  }
}

// ---------------------------------------------------------------------------
//  KASA GEÇMİŞİ İÇE AKTAR — 100 Kasa hesabının eski hareketlerini (xlsx) yükler
//  Sütunlar: No(atlanır) · Tarih · İşlem Adı · Şahıs · Açıklama · Rapor ·
//            Giren · Çıkan · Güncel Tutar(yalnızca doğrulama).
//  İşlem No uygulama tarafından yeniden verilir (dosya sırası = 1..N).
//  Açılış bakiyesi = ilk satırın Güncel'i − (ilk Giren − ilk Çıkan) → böylece
//  hesaplanan son bakiye dosyadaki son Güncel ile birebir uyar.
//  source:"kasa-gecmis" ile işaretlenir → tekrar yüklemede öncekiler silinir.
// ---------------------------------------------------------------------------
const KASA_SRC = "kasa-gecmis";
async function viewKasaImport(c) {
  if (!isAdmin()) {
    c.innerHTML = `<div class="notice warn">⚠️ Bu sayfa yalnızca yöneticilere açıktır.</div>`;
    return;
  }
  const accounts = await fetchAll(C.accounts).catch(() => []);
  const kasa = accounts.find((a) => String(a.code) === "100")
            || accounts.find((a) => a.type === "kasa" && !a.parentId)
            || accounts.find((a) => a.type === "kasa");
  const priorEntries = await fetchAll(C.accountEntries).catch(() => []);
  const priorCount = kasa ? priorEntries.filter((e) => e.accountId === kasa.id && e.source === KASA_SRC).length : 0;

  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>📒 Kasa Geçmişi İçe Aktar</h3><a class="btn btn-sm" href="#/hesaplar">← Hesaplar</a></div>
      ${!kasa ? `<div class="notice warn">⚠️ <b>100 Kasa</b> hesabı bulunamadı. Önce Hesaplar sayfasından oluşturun.</div>` : `
      <div class="pv-fhint">Excel (.xlsx) yükleyin — sütunlar: <b>Tarih · İşlem Adı · Şahıs · Açıklama · Rapor · Giren · Çıkan · Güncel Tutar</b>.<br>
        İşlem numaraları <b>uygulama tarafından</b> yeniden verilir (dosya sırası 1…N). <b>Güncel Tutar</b> yalnızca doğrulama için kullanılır.<br>
        Hedef hesap: <b>${esc(kasa.code || "")} ${esc(kasa.name || "")}</b>.
        ${priorCount ? `<br>⚠️ Bu hesapta daha önce içe aktarılmış <b>${priorCount.toLocaleString("tr-TR")}</b> geçmiş hareket var — yeni yükleme <b>bunların yerini alır</b>.` : ""}</div>
      <div id="ka-drop" style="margin-top:12px"></div>`}
    </div>
    <div id="ka-editor"></div>`;
  if (!kasa) return;

  const pad2 = (n) => String(n).padStart(2, "0");
  const kdate = (v) => {
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    const m = String(v || "").trim().match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (!m) return "";
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
  };

  $("#ka-drop").appendChild(fileDrop(async (file) => {
    const lb = loadingBar("Dosya okunuyor…");
    try {
      const aoa = await parseSheetAOA(file);
      lb.finish(() => build(aoa));
    } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
  }, ".xlsx,.xls", true));

  function build(aoa) {
    // Başlık satırını bul: tarih + (giren/çıkan) + açıklama içeren satır
    let hi = aoa.findIndex((r) => {
      const j = (r || []).map(normTr).join("|");
      return j.includes("tarih") && (j.includes("giren") || j.includes("cikan")) && j.includes("aciklama");
    });
    if (hi < 0) hi = aoa.findIndex((r) => (r || []).some((x) => String(x).trim() !== ""));
    if (hi < 0) return toast("Veri bulunamadı.", "err");
    const header = aoa[hi] || [];
    const idxOf = (kw) => header.findIndex((h) => normTr(h).includes(kw));
    const col = {
      date: idxOf("tarih"), islemAdi: idxOf("islem ad"), sahis: idxOf("sahis"),
      aciklama: idxOf("aciklama"), rapor: idxOf("rapor"),
      giren: idxOf("giren"), cikan: idxOf("cikan"), guncel: idxOf("guncel"),
    };
    if (col.date < 0 || (col.giren < 0 && col.cikan < 0))
      return toast("'Tarih' ve 'Giren/Çıkan' sütunları bulunamadı.", "err");

    const get = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const rows = [];
    aoa.slice(hi + 1).forEach((r) => {
      if (!r || !r.some((x) => String(x).trim() !== "")) return;
      const date = kdate(r[col.date]);
      const giren = col.giren >= 0 ? parseNum(r[col.giren]) : 0;
      const cikan = col.cikan >= 0 ? parseNum(r[col.cikan]) : 0;
      const islemAdi = get(r, col.islemAdi), sahis = get(r, col.sahis);
      const aciklama = get(r, col.aciklama), rapor = get(r, col.rapor);
      // Tamamen boş / başlık tekrarı satırlarını atla
      if (!date && !giren && !cikan && !islemAdi && !aciklama) return;
      const gRaw = col.guncel >= 0 ? String(r[col.guncel] ?? "").trim() : "";
      const guncel = gRaw !== "" ? parseNum(r[col.guncel]) : null;
      rows.push({ date, islemAdi, sahis, aciklama, rapor, giren, cikan, guncel });
    });
    if (!rows.length) return toast("İşlenecek satır bulunamadı.", "err");

    // Açılış bakiyesi: ilk satırın Güncel'inden o satırın hareketini geri al
    const first = rows[0];
    const opening = first.guncel != null ? (first.guncel - (first.giren - first.cikan)) : 0;

    // Doğrulama: dosya sırasında yürüyen bakiye, Güncel Tutar ile örtüşmeli
    let run = opening, mismatch = 0, firstBad = null;
    rows.forEach((r, i) => {
      run += r.giren - r.cikan;
      r.run = run;
      if (r.guncel != null && Math.abs(run - r.guncel) > 0.5) { mismatch++; if (firstBad == null) firstBad = i; }
    });
    const finalBal = run;
    const last = rows[rows.length - 1];
    const totGiren = rows.reduce((s, r) => s + r.giren, 0);
    const totCikan = rows.reduce((s, r) => s + r.cikan, 0);
    const noDate = rows.filter((r) => !r.date).length;
    const ok = mismatch === 0;

    const editor = $("#ka-editor");
    editor.innerHTML = `
      <div class="card">
        <div class="pv-head">
          <div class="pv-title">${rows.length.toLocaleString("tr-TR")} hareket okundu</div>
          <div class="pv-sub">Giren ${fmtTRY(totGiren)} · Çıkan ${fmtTRY(totCikan)}${noDate ? ` · ${noDate} tarihsiz` : ""}</div>
        </div>
        <div class="ka-grid">
          <div class="ka-cell"><div class="k">Açılış Bakiyesi</div><div class="v">${fmtTRY(opening)}</div></div>
          <div class="ka-cell"><div class="k">Hesaplanan Son Bakiye</div><div class="v">${fmtTRY(finalBal)}</div></div>
          <div class="ka-cell"><div class="k">Dosyadaki Son Güncel</div><div class="v">${last.guncel != null ? fmtTRY(last.guncel) : "—"}</div></div>
        </div>
        <div class="notice ${ok ? "info" : "warn"}" style="margin-top:12px">
          ${ok
            ? `✅ <b>Doğrulama başarılı</b> — yürüyen bakiye tüm satırlarda “Güncel Tutar” ile birebir uyuşuyor.`
            : `⚠️ <b>${mismatch.toLocaleString("tr-TR")} satırda</b> yürüyen bakiye “Güncel Tutar” ile uyuşmuyor (ilki: ${firstBad + 1}. satır — hesaplanan ${fmtTRY(rows[firstBad].run)}, dosyada ${fmtTRY(rows[firstBad].guncel)}). Yine de aktarabilirsiniz; sıralama/eksik satır olabilir.`}
        </div>
        <div class="table-wrap" style="margin-top:12px"><table class="data">
          <thead><tr>
            <th>#</th><th>Tarih</th><th>İşlem Adı</th><th>Şahıs</th><th>Açıklama</th><th>Rapor</th>
            <th class="num">Giren</th><th class="num">Çıkan</th><th class="num">Bakiye</th><th class="num">Dosya Güncel</th>
          </tr></thead>
          <tbody>${rows.slice(0, 50).map((r, i) => {
            const bad = r.guncel != null && Math.abs(r.run - r.guncel) > 0.5;
            return `<tr class="${bad ? "hl-row" : ""}">
              <td><b>${i + 1}</b></td>
              <td>${r.date ? fmtDate(r.date) : '<span style="color:var(--danger)">—</span>'}</td>
              <td>${esc(r.islemAdi)}</td>
              <td>${esc(r.sahis)}</td>
              <td>${esc(r.aciklama)}</td>
              <td>${esc(r.rapor)}</td>
              <td class="num" style="color:var(--ok)">${r.giren ? fmtTRY(r.giren) : "—"}</td>
              <td class="num" style="color:var(--danger)">${r.cikan ? fmtTRY(r.cikan) : "—"}</td>
              <td class="num" style="font-weight:700">${fmtTRY(r.run)}</td>
              <td class="num" style="color:${bad ? "var(--danger)" : "var(--ink-faint)"}">${r.guncel != null ? fmtTRY(r.guncel) : "—"}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
        ${rows.length > 50 ? `<div class="pv-fhint">İlk 50 satır gösteriliyor; hepsi (${rows.length.toLocaleString("tr-TR")}) aktarılacak.</div>` : ""}
      </div>
      <div class="pv-cta">
        <div class="grow"></div>
        <button class="btn btn-primary" id="ka-save">✓ ${rows.length.toLocaleString("tr-TR")} Hareketi İçe Aktar</button>
      </div>`;

    $("#ka-save", editor).onclick = () => {
      confirmDialog(
        `${rows.length.toLocaleString("tr-TR")} hareket “${kasa.code} ${kasa.name}” hesabına aktarılacak.` +
        (priorCount ? ` Önceki ${priorCount.toLocaleString("tr-TR")} geçmiş hareket silinecek.` : "") +
        ` Açılış bakiyesi ${fmtTRY(opening)}, son bakiye ${fmtTRY(finalBal)} olacak. Devam edilsin mi?`,
        () => doImport(rows, opening));
    };
  }

  async function doImport(rows, opening) {
    const pb = progressBar("Kasa geçmişi aktarılıyor…");
    try {
      // 1) Açılış bakiyesini ayarla
      pb.set(2, "Açılış bakiyesi ayarlanıyor…");
      await updateDoc(doc(db, "accounts", kasa.id), { openingBalance: opening });

      // 2) Önceki geçmiş hareketleri sil (yeniden yüklemede birikmesin)
      const stale = priorEntries.filter((e) => e.accountId === kasa.id && e.source === KASA_SRC);
      if (stale.length) {
        pb.set(5, `${stale.length.toLocaleString("tr-TR")} eski kayıt siliniyor…`);
        for (let i = 0; i < stale.length; i += 400) {
          const b = writeBatch(db);
          stale.slice(i, i + 400).forEach((e) => b.delete(doc(db, "accountEntries", e.id)));
          await b.commit();
        }
      }

      // 3) Yeni hareketleri parçalar hâlinde yaz (İşlem No = dosya sırası)
      const now = new Date().toISOString();
      const docs = rows.map((r, i) => ({
        accountId: kasa.id, accountCode: String(kasa.code || "100"),
        islemNo: i + 1, date: r.date, islemAdi: r.islemAdi, sahis: r.sahis,
        aciklama: r.aciklama, rapor: r.rapor,
        giren: r.giren || 0, cikan: r.cikan || 0,
        source: KASA_SRC, createdAt: now,
      }));
      const total = docs.length;
      for (let i = 0; i < total; i += 400) {
        const b = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => b.set(doc(C.accountEntries()), d));
        await b.commit();
        const done = Math.min(i + 400, total);
        pb.set(10 + Math.round((done / total) * 88), `${done.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")}`);
      }

      await logAction("İçe Aktarma", "Kasa Geçmişi", `${total} hareket · açılış ${fmtTRY(opening)}`);
      pb.done(() => {
        successAnim(`${total.toLocaleString("tr-TR")} kasa hareketi aktarıldı`, () => {
          location.hash = "#/hesap-detay?id=" + kasa.id;
        });
      });
    } catch (e) {
      pb.done(() => toast("Hata: " + e.message, "err"));
    }
  }
}

// ---------------------------------------------------------------------------
//  BANKA GEÇMİŞİ İÇE AKTAR — tek dosyada iki banka (Garanti + T.Finans)
//  Sütunlar: BANKA KG(atlanır) · NO(atlanır) · Tarih · BANKA(hesabı belirler) ·
//            İşlem Adı · Şahıs · Açıklama · Rapor · Giren · Çıkan · Banka Bakiyesi(doğrulama)
//  GARANTİ → 102.01 · T.FINANS → 102.02. Her banka kendi yürüyen bakiyesiyle.
//  İşlem No uygulama tarafından (her banka 1…N). source:"banka-gecmis".
// ---------------------------------------------------------------------------
const BANKA_SRC = "banka-gecmis";
async function viewBankaImport(c) {
  if (!isAdmin()) {
    c.innerHTML = `<div class="notice warn">⚠️ Bu sayfa yalnızca yöneticilere açıktır.</div>`;
    return;
  }
  const accounts = await fetchAll(C.accounts).catch(() => []);
  const findByCode = (code) => accounts.find((a) => String(a.code) === code);
  const BANKS = [
    { key: "garanti", label: "Garanti", match: (n) => n.includes("garanti"), acc: findByCode("102.01") },
    { key: "tfinans", label: "T. Finans", match: (n) => n.includes("finans"), acc: findByCode("102.02") },
  ];
  const priorEntries = await fetchAll(C.accountEntries).catch(() => []);
  const priorCount = priorEntries.filter((e) => e.source === BANKA_SRC
    && BANKS.some((b) => b.acc && e.accountId === b.acc.id)).length;
  const missing = BANKS.filter((b) => !b.acc);

  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>🏦 Banka Geçmişi İçe Aktar</h3><a class="btn btn-sm" href="#/hesaplar">← Hesaplar</a></div>
      ${missing.length ? `<div class="notice warn">⚠️ Şu hesap(lar) bulunamadı: <b>${missing.map((b) => b.key === "garanti" ? "102.01 Garanti" : "102.02 Türkiye Finans").join(", ")}</b>. Önce Hesaplar'dan varsayılan planı oluşturun.</div>` : `
      <div class="pv-fhint">Excel (.xlsx) yükleyin. <b>BANKA</b> sütununa göre satırlar ayrılır:
        <b>GARANTİ → 102.01</b>, <b>T.FINANS → 102.02</b>. Her banka kendi yürüyen bakiyesiyle işlenir.<br>
        İşlem numaraları uygulama tarafından verilir. <b>Banka Bakiyesi</b> yalnız doğrulama için kullanılır.
        ${priorCount ? `<br>⚠️ Daha önce içe aktarılmış <b>${priorCount.toLocaleString("tr-TR")}</b> banka geçmişi hareketi var — yeni yükleme <b>bunların yerini alır</b>.` : ""}</div>
      <div id="bi-drop" style="margin-top:12px"></div>`}
    </div>
    <div id="bi-editor"></div>`;
  if (missing.length) return;

  const pad2 = (n) => String(n).padStart(2, "0");
  const bdate = (v) => {
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    const m = String(v || "").trim().match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (!m) return "";
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
  };

  $("#bi-drop").appendChild(fileDrop(async (file) => {
    const lb = loadingBar("Dosya okunuyor…");
    try {
      const aoa = await parseSheetAOA(file);
      lb.finish(() => build(aoa));
    } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
  }, ".xlsx,.xls", true));

  function build(aoa) {
    // Başlık satırı: tarih + banka + bakiye içeren satır
    let hi = aoa.findIndex((r) => {
      const j = (r || []).map(normTr).join("|");
      return j.includes("tarih") && j.includes("banka") && j.includes("bakiye");
    });
    if (hi < 0) hi = aoa.findIndex((r) => (r || []).some((x) => String(x).trim() !== ""));
    if (hi < 0) return toast("Veri bulunamadı.", "err");
    const header = (aoa[hi] || []).map((h) => normTr(h));
    const idxIncl = (kw) => header.findIndex((h) => h.includes(kw));
    const idxExact = (kw) => header.findIndex((h) => h === kw);
    const col = {
      date: idxIncl("tarih"), banka: idxExact("banka"), islemAdi: idxIncl("islem ad"),
      sahis: idxIncl("sahis"), aciklama: idxIncl("aciklama"), rapor: idxIncl("rapor"),
      giren: idxIncl("giren"), cikan: idxIncl("cikan"), bakiye: idxIncl("bakiye"),
    };
    if (col.banka < 0 || col.date < 0 || (col.giren < 0 && col.cikan < 0))
      return toast("'Banka', 'Tarih' ve 'Giren/Çıkan' sütunları bulunamadı.", "err");

    const get = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const rows = [];
    const byBank = { garanti: [], tfinans: [] };
    let unknown = 0;
    aoa.slice(hi + 1).forEach((r) => {
      if (!r || !r.some((x) => String(x).trim() !== "")) return;
      const bn = normTr(r[col.banka]);
      const bank = BANKS.find((b) => b.match(bn));
      const date = bdate(r[col.date]);
      const giren = col.giren >= 0 ? parseNum(r[col.giren]) : 0;
      const cikan = col.cikan >= 0 ? parseNum(r[col.cikan]) : 0;
      const islemAdi = get(r, col.islemAdi), sahis = get(r, col.sahis);
      const aciklama = get(r, col.aciklama), rapor = get(r, col.rapor);
      if (!date && !giren && !cikan && !islemAdi && !aciklama) return;
      if (!bank) { if (bn) unknown++; return; }
      const gRaw = col.bakiye >= 0 ? String(r[col.bakiye] ?? "").trim() : "";
      const bakiye = gRaw !== "" ? parseNum(r[col.bakiye]) : null;
      const row = { bankKey: bank.key, date, islemAdi, sahis, aciklama, rapor, giren, cikan, bakiye };
      rows.push(row);
      byBank[bank.key].push(row);
    });
    if (!rows.length) return toast("İşlenecek satır bulunamadı.", "err");

    // Her banka için toplamlar. Açılış bakiyesi KULLANICI tarafından girilir —
    // dosyadaki "Banka Bakiyesi" bu üründe net tutar (giren−çıkan), güvenilir değil.
    const stats = {};
    BANKS.forEach((b) => {
      const list = byBank[b.key];
      if (!list.length) { stats[b.key] = null; return; }
      const totGiren = list.reduce((s, r) => s + r.giren, 0);
      const totCikan = list.reduce((s, r) => s + r.cikan, 0);
      stats[b.key] = { count: list.length, totGiren, totCikan, net: totGiren - totCikan };
    });

    const card = (b) => {
      const s = stats[b.key];
      if (!s) return `<div class="ka-cell"><div class="k">${b.label}</div><div class="v" style="font-size:13px;color:var(--ink-soft)">dosyada yok</div></div>`;
      return `<div class="ka-cell" style="text-align:left">
        <div class="k">${b.label} · ${s.count.toLocaleString("tr-TR")} hareket</div>
        <div class="field" style="margin:8px 0 6px">
          <label style="font-size:11px;color:var(--ink-soft)">Açılış Bakiyesi</label>
          <div class="money-wrap"><input class="num money bi-open" data-bank="${b.key}" inputmode="decimal" value="0,00" /><span class="cur">₺</span></div>
        </div>
        <div style="font-size:12px;color:var(--ink-soft)">Giren ${fmtTRY(s.totGiren)} · Çıkan ${fmtTRY(s.totCikan)}</div>
        <div style="font-size:14px;font-weight:800;margin-top:5px">Son Bakiye: <span class="bi-final" data-bank="${b.key}">${fmtTRY(s.net)}</span></div>
      </div>`;
    };

    const editor = $("#bi-editor");
    editor.innerHTML = `
      <div class="card">
        <div class="pv-head"><div class="pv-title">${rows.length.toLocaleString("tr-TR")} hareket okundu</div>
          <div class="pv-sub">${unknown ? unknown + " satır bilinmeyen banka (atlandı) · " : ""}Garanti + T. Finans</div></div>
        <div class="notice info" style="margin-bottom:10px">Her bankanın <b>Açılış Bakiyesi</b>'ni girin — <b>Son Bakiye</b> anında hesaplanır. (T. Finans genelde 0.) Bilinen güncel bakiyeyi tutturmak için açılışı ayarlayın.</div>
        <div class="ka-grid">${BANKS.map(card).join("")}</div>
        <div class="table-wrap" style="margin-top:12px"><table class="data">
          <thead><tr>
            <th>Banka</th><th>Tarih</th><th>İşlem Adı</th><th>Şahıs</th><th>Açıklama</th><th>Rapor</th>
            <th class="num">Giren</th><th class="num">Çıkan</th>
          </tr></thead>
          <tbody>${rows.slice(0, 60).map((r) => `<tr>
              <td>${r.bankKey === "garanti" ? "Garanti" : "T. Finans"}</td>
              <td>${r.date ? fmtDate(r.date) : '<span style="color:var(--danger)">—</span>'}</td>
              <td>${esc(r.islemAdi)}</td><td>${esc(r.sahis)}</td><td>${esc(r.aciklama)}</td><td>${esc(r.rapor)}</td>
              <td class="num" style="color:var(--ok)">${r.giren ? fmtTRY(r.giren) : "—"}</td>
              <td class="num" style="color:var(--danger)">${r.cikan ? fmtTRY(r.cikan) : "—"}</td>
            </tr>`).join("")}</tbody>
        </table></div>
        ${rows.length > 60 ? `<div class="pv-fhint">İlk 60 satır gösteriliyor; hepsi (${rows.length.toLocaleString("tr-TR")}) aktarılacak.</div>` : ""}
      </div>
      <div class="pv-cta"><div class="grow"></div>
        <button class="btn btn-primary" id="bi-save">✓ ${rows.length.toLocaleString("tr-TR")} Hareketi İçe Aktar</button></div>`;

    // Açılış girişi → Son Bakiye canlı güncellenir
    const openOf = (key) => parseNum($(`.bi-open[data-bank="${key}"]`, editor)?.value || 0);
    const refreshFinals = () => BANKS.forEach((b) => {
      const s = stats[b.key]; if (!s) return;
      const el = $(`.bi-final[data-bank="${b.key}"]`, editor);
      if (el) el.textContent = fmtTRY(openOf(b.key) + s.net);
    });
    wireMoney(editor);
    $$(".bi-open", editor).forEach((inp) => inp.addEventListener("input", refreshFinals));

    $("#bi-save", editor).onclick = () => {
      const openings = {}; BANKS.forEach((b) => { if (stats[b.key]) openings[b.key] = openOf(b.key); });
      const parts = BANKS.filter((b) => stats[b.key]).map((b) =>
        `${b.label}: ${stats[b.key].count.toLocaleString("tr-TR")} hareket, açılış ${fmtTRY(openings[b.key])} → son ${fmtTRY(openings[b.key] + stats[b.key].net)}`);
      confirmDialog(
        `${rows.length.toLocaleString("tr-TR")} hareket aktarılacak. ${parts.join(" · ")}.` +
        (priorCount ? ` Önceki ${priorCount.toLocaleString("tr-TR")} banka geçmişi silinecek.` : "") +
        ` Devam edilsin mi?`,
        () => doImport(byBank, stats, openings));
    };
  }

  async function doImport(byBank, stats, openings) {
    const pb = progressBar("Banka geçmişi aktarılıyor…");
    try {
      // 1) Önceki banka-gecmis kayıtlarını sil (iki hesap için)
      const stale = priorEntries.filter((e) => e.source === BANKA_SRC
        && BANKS.some((b) => b.acc && e.accountId === b.acc.id));
      if (stale.length) {
        pb.set(4, `${stale.length.toLocaleString("tr-TR")} eski kayıt siliniyor…`);
        for (let i = 0; i < stale.length; i += 400) {
          const bt = writeBatch(db);
          stale.slice(i, i + 400).forEach((e) => bt.delete(doc(db, "accountEntries", e.id)));
          await bt.commit();
        }
      }

      // 2) Her banka: açılış bakiyesi + hareketler (İşlem No 1…N)
      const now = new Date().toISOString();
      const docs = [];
      for (const b of BANKS) {
        const s = stats[b.key]; if (!s) continue;
        await updateDoc(doc(db, "accounts", b.acc.id), { openingBalance: openings[b.key] || 0 });
        byBank[b.key].forEach((r, i) => docs.push({
          accountId: b.acc.id, accountCode: String(b.acc.code),
          islemNo: i + 1, date: r.date, islemAdi: r.islemAdi, sahis: r.sahis,
          aciklama: r.aciklama, rapor: r.rapor, giren: r.giren || 0, cikan: r.cikan || 0,
          source: BANKA_SRC, createdAt: now,
        }));
      }

      const total = docs.length;
      for (let i = 0; i < total; i += 400) {
        const bt = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => bt.set(doc(C.accountEntries()), d));
        await bt.commit();
        const done = Math.min(i + 400, total);
        pb.set(10 + Math.round((done / total) * 88), `${done.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")}`);
      }

      await logAction("İçe Aktarma", "Banka Geçmişi", `${total} hareket (Garanti + T.Finans)`);
      pb.done(() => {
        successAnim(`${total.toLocaleString("tr-TR")} banka hareketi aktarıldı`, () => {
          location.hash = "#/hesaplar";
        });
      });
    } catch (e) {
      pb.done(() => toast("Hata: " + e.message, "err"));
    }
  }
}

// ---------------------------------------------------------------------------
//  CARİ GEÇMİŞİ İÇE AKTAR — cari (120/320) hesaplarının borç/alacak hareketleri
//  Eşleme: ŞAHIS adı → mevcut cari hesap (Toplu Cari ile eklenenler).
//  Sütunlar: CARİ NO(bilgi) · NO(atlanır) · Tarih · Şahıs · Açıklama · Rapor ·
//            Borç · Alacak · Bakiye(net, kullanılmaz) · Fatura · Fatura No
//  Açılış 0 (sadece hareketler). İşlem No uygulama tarafından (hesap başına 1…N).
// ---------------------------------------------------------------------------
const CARI_SRC = "cari-gecmis";
async function viewCariGecmisImport(c) {
  if (!isAdmin()) {
    c.innerHTML = `<div class="notice warn">⚠️ Bu sayfa yalnızca yöneticilere açıktır.</div>`;
    return;
  }
  const accounts = await fetchAll(C.accounts).catch(() => []);
  // Havuz: TÜM alt hesaplar (120/320/336/128/108 bloke… her tür) — ana başlıklar hariç
  const cariAccounts = accounts.filter((a) => a.parentId);
  const nameMap = new Map();          // normTr(ad) → hesap (tam eşleşme)
  const extMap = new Map();           // cari no (extNo) → hesap
  // Gevşek anahtar: noktalama/boşluk farkını yok sayar (ör. "Av. Uğur"→"av ugur")
  const looseKey = (s) => normTr(s).replace(/[^0-9a-z]+/g, " ").replace(/\s+/g, " ").trim();
  const looseMap = new Map();         // looseKey → hesap (yalnız TEKil olanlar güvenli)
  const looseAmbig = new Set();       // birden çok hesaba denk gelen anahtarlar (kullanılmaz)
  const codeMap = new Map();          // hesap kodu (ör. "108.02") → hesap
  cariAccounts.forEach((a) => {
    const k = normTr(a.name); if (k && !nameMap.has(k)) nameMap.set(k, a);
    const e = String(a.extNo || "").trim(); if (e && !extMap.has(e)) extMap.set(e, a);
    const cc = String(a.code || "").trim(); if (cc && !codeMap.has(cc)) codeMap.set(cc, a);
    const lk = looseKey(a.name); if (!lk) return;
    const cur = looseMap.get(lk);
    if (cur && cur.id !== a.id) looseAmbig.add(lk);
    else if (!cur) looseMap.set(lk, a);
  });
  // Elle düzeltme (opsiyonel): normTr(Şahıs) → yönlendirilecek hesap. "Eşleşmeyenler" CSV'sine
  // eklenen "yapılacaklar" sütunundan kurulur (KOY→En Yakın Kod, ad→o hesap, KOYMA/boş→dokunma).
  const overrideMap = new Map();
  let overrideStats = null;   // { applied, unresolved:[] } | { err }
  let lastAoa = null;         // yüklenen hareket dosyası — düzeltme sonrası yeniden eşleştirmek için
  const priorEntries = await fetchAll(C.accountEntries).catch(() => []);
  const priorCount = priorEntries.filter((e) => e.source === CARI_SRC).length;

  c.innerHTML = `
    <div class="card">
      <div class="card-head"><h3>🧾 Cari Geçmişi İçe Aktar</h3><a class="btn btn-sm" href="#/hesaplar">← Hesaplar</a></div>
      ${!cariAccounts.length ? `<div class="notice warn">⚠️ Kayıtlı alt hesap yok. Önce <b>Toplu Cari İçe Aktar</b> ile hesapları oluşturun.</div>` : `
      <div class="pv-fhint">Excel (.xlsx) yükleyin — "Cari Verileri" sayfası. Satırlar <b>ŞAHIS adına göre</b> mevcut hesaplara eşleştirilir (108 bloke dahil tüm türler).
        İşlem numaraları uygulama tarafından verilir; <b>açılış 0</b> (yalnız hareketler eklenir).<br>
        Mevcut <b>${cariAccounts.length.toLocaleString("tr-TR")}</b> cari hesap var.
        ${priorCount ? `<br>⚠️ Daha önce içe aktarılmış <b>${priorCount.toLocaleString("tr-TR")}</b> cari geçmişi hareketi var — yeni yükleme <b>bunların yerini alır</b>.` : ""}</div>
      <div id="cg-drop" style="margin-top:12px"></div>
      <details style="margin-top:10px">
        <summary style="cursor:pointer;color:var(--ink-soft);font-weight:600">🔧 Düzeltme dosyası (opsiyonel) — eşleşmeyenleri elle yönlendir</summary>
        <div class="pv-fhint" style="margin-top:6px">İndirdiğiniz <b>eşleşmeyenler</b> CSV'sine bir <b>yapılacaklar</b> sütunu ekleyip yükleyin:
          <br>• <b>KOY</b> (ör. "EN YAKIN … KOY") → o şahsın hareketleri <b>En Yakın Kod</b>'daki hesaba yazılır
          <br>• Bir <b>hesap adı</b> yazarsanız → tam o adlı hesaba yazılır
          <br>• <b>KOYMA</b> / boş → dokunulmaz (aşağıdaki grupta yeni cari açılır)</div>
        <div id="cg-corr-drop" style="margin-top:8px"></div>
        <div id="cg-corr-status" style="margin-top:6px"></div>
      </details>`}
    </div>
    <div id="cg-editor"></div>`;
  if (!cariAccounts.length) return;

  const pad2 = (n) => String(n).padStart(2, "0");
  const cdate = (v) => {
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
    const m = String(v || "").trim().match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
    if (!m) return "";
    let y = m[3]; if (y.length === 2) y = "20" + y;
    return `${y}-${pad2(+m[2])}-${pad2(+m[1])}`;
  };

  $("#cg-drop").appendChild(fileDrop(async (file) => {
    const lb = loadingBar("Dosya okunuyor…");
    try {
      const aoa = await parseSheetAOA(file);
      lastAoa = aoa;
      lb.finish(() => build(aoa));
    } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
  }, ".xlsx,.xls", true));

  // Düzeltme dosyası — yükleyince overrideMap kurulur; hareket dosyası zaten
  // yüklüyse önizleme yeni yönlendirmelerle otomatik yenilenir.
  $("#cg-corr-drop")?.appendChild(fileDrop(async (file) => {
    const lb = loadingBar("Düzeltme okunuyor…");
    try {
      const aoa = await parseTableAOA(file);
      applyCorrections(aoa);
      lb.finish(() => { if (lastAoa) build(lastAoa); });
    } catch (e) { lb.finish(); toast("Düzeltme okunamadı: " + e.message, "err"); }
  }, ".csv,.xlsx,.xls", true));

  function renderCorrStatus() {
    const el = $("#cg-corr-status"); if (!el) return;
    if (!overrideStats) { el.innerHTML = ""; return; }
    if (overrideStats.err) { el.innerHTML = `<div class="notice warn">⚠️ ${esc(overrideStats.err)}</div>`; return; }
    const { applied, unresolved } = overrideStats;
    const cls = unresolved.length ? "warn" : "info";
    el.innerHTML = `<div class="notice ${cls}">✓ <b>${applied}</b> yönlendirme hazır` +
      (unresolved.length
        ? ` · <b>${unresolved.length}</b> hedef bulunamadı (bu şahıslar gruba açılır): ${esc(unresolved.slice(0, 6).map((u) => u.sahis).join(", "))}${unresolved.length > 6 ? "…" : ""}`
        : "") + `</div>`;
  }

  // "yapılacaklar" sütununu okuyup overrideMap'i kurar.
  function applyCorrections(aoa) {
    overrideMap.clear(); overrideStats = null;
    let hi = (aoa || []).findIndex((r) => (r || []).map(normTr).join("|").includes("sahis"));
    if (hi < 0) { overrideStats = { err: "‘Sahis’ sütunu bulunamadı." }; return renderCorrStatus(); }
    const H = (aoa[hi] || []).map((h) => normTr(h));
    const ic = {
      sahis: H.findIndex((h) => h.includes("sahis")),
      kod:   H.findIndex((h) => h.includes("yakinkod") || h === "kod"),
      todo:  H.findIndex((h) => h.includes("yapilacak")),
    };
    if (ic.sahis < 0 || ic.todo < 0) { overrideStats = { err: "‘Sahis’ ve ‘yapılacaklar’ sütunları gerekli." }; return renderCorrStatus(); }
    let applied = 0; const unresolved = [];
    aoa.slice(hi + 1).forEach((r) => {
      const sahis = String(r[ic.sahis] ?? "").trim();
      const todo = String(r[ic.todo] ?? "").trim();
      if (!sahis || !todo) return;
      const nt = normTr(todo);
      if (nt.includes("koyma")) return;                 // dokunma → grupta yeni cari açılır
      let acc = null;
      if (nt.includes("koy")) {                          // En Yakın Kod'daki hesaba bağla
        const kod = ic.kod >= 0 ? String(r[ic.kod] ?? "").trim() : "";
        acc = kod ? codeMap.get(kod) || null : null;
      } else {                                           // belirli hesap adı
        acc = nameMap.get(nt) || null;
        if (!acc) { const lk = looseKey(todo); if (lk && !looseAmbig.has(lk)) acc = looseMap.get(lk) || null; }
      }
      if (acc) { overrideMap.set(normTr(sahis), acc); applied++; }
      else unresolved.push({ sahis, todo });
    });
    overrideStats = { applied, unresolved };
    renderCorrStatus();
  }

  function build(aoa) {
    let hi = aoa.findIndex((r) => {
      const j = (r || []).map(normTr).join("|");
      return j.includes("sahis") && j.includes("borc") && j.includes("alacak");
    });
    if (hi < 0) hi = aoa.findIndex((r) => (r || []).some((x) => String(x).trim() !== ""));
    if (hi < 0) return toast("Veri bulunamadı.", "err");
    const header = (aoa[hi] || []).map((h) => normTr(h));
    const idxIncl = (kw) => header.findIndex((h) => h.includes(kw));
    const idxExact = (kw) => header.findIndex((h) => h === kw);
    const col = {
      cariNo: idxIncl("cari no"), date: idxIncl("tarih"), sahis: idxIncl("sahis"),
      aciklama: idxIncl("aciklama"), rapor: idxIncl("rapor"),
      borc: idxIncl("borc"), alacak: idxIncl("alacak"),
      fatura: idxExact("fatura"), faturaNo: idxIncl("fatura no"),
    };
    if (col.sahis < 0 || (col.borc < 0 && col.alacak < 0))
      return toast("'Şahıs' ve 'Borç/Alacak' sütunları bulunamadı.", "err");

    const get = (r, i) => (i >= 0 ? String(r[i] ?? "").trim() : "");
    const byAcc = new Map();       // accountId → { acc, rows:[] }
    const unmatched = new Map();   // normTr(ad) → { name, rows:[] }  (programda olmayan cariler)
    const ovHit = new Set();       // düzeltme ile yönlendirilen şahıslar (özet için)
    let total = 0;
    aoa.slice(hi + 1).forEach((r) => {
      if (!r || !r.some((x) => String(x).trim() !== "")) return;
      const sahis = get(r, col.sahis);
      if (!sahis) return;
      const borc = col.borc >= 0 ? parseNum(r[col.borc]) : 0;
      const alacak = col.alacak >= 0 ? parseNum(r[col.alacak]) : 0;
      const date = cdate(r[col.date]);
      if (!date && !borc && !alacak) return;
      total++;
      const nk = normTr(sahis);
      let acc = overrideMap.get(nk);                 // elle düzeltme her şeyden önce gelir
      if (acc) ovHit.add(nk);
      else acc = nameMap.get(nk);
      if (!acc) { const lk = looseKey(sahis); if (lk && !looseAmbig.has(lk)) acc = looseMap.get(lk) || null; }
      const row = {
        cariNo: get(r, col.cariNo), date, sahis, aciklama: get(r, col.aciklama), rapor: get(r, col.rapor),
        borc, alacak, faturaTuru: get(r, col.fatura), faturaNo: get(r, col.faturaNo),
      };
      if (!acc) {
        const k = normTr(sahis);
        const u = unmatched.get(k) || { name: sahis, rows: [] };
        u.rows.push(row); unmatched.set(k, u);
        return;
      }
      if (!byAcc.has(acc.id)) byAcc.set(acc.id, { acc, rows: [] });
      byAcc.get(acc.id).rows.push(row);
    });

    const matchedRows = [...byAcc.values()].reduce((s, x) => s + x.rows.length, 0);
    const unmatchedRows = [...unmatched.values()].reduce((s, x) => s + x.rows.length, 0);
    if (!matchedRows && !unmatchedRows) return toast("Hiçbir hareket okunamadı (Şahıs/Borç/Alacak sütunları boş).", "err");

    // Önizleme için ilk 60 eşleşen satır (dosya sırasında)
    const preview = [];
    for (const { acc, rows } of byAcc.values()) for (const r of rows) { preview.push({ acc, r }); if (preview.length >= 60) break; }

    const editor = $("#cg-editor");
    const unmatchedList = [...unmatched.values()].sort((a, b) => b.rows.length - a.rows.length);
    const mainAccts = accounts.filter((a) => !a.parentId && a.code)
      .sort((x, y) => String(x.code).localeCompare(String(y.code), "tr"));
    const defGroup = mainAccts.find((a) => String(a.code) === "321")
      || mainAccts.find((a) => String(a.code) === "320")
      || mainAccts.find((a) => isCari(a.type)) || mainAccts[0];
    editor.innerHTML = `
      <div class="card">
        <div class="pv-head"><div class="pv-title">${total.toLocaleString("tr-TR")} hareket okundu</div>
          <div class="pv-sub">${byAcc.size.toLocaleString("tr-TR")} cari hesaba eşleşti · ${matchedRows.toLocaleString("tr-TR")} hareket aktarılacak${ovHit.size ? ` · 🔧 ${ovHit.size} şahıs düzeltmeyle yönlendirildi` : ""}</div></div>
        ${unmatchedRows ? `<div class="notice warn" style="margin-bottom:10px">⚠️ <b>${unmatchedList.length}</b> şahıs programda yok (${unmatchedRows.toLocaleString("tr-TR")} satır): ${esc(unmatchedList.slice(0, 8).map((u) => u.name + " (" + u.rows.length + ")").join(", "))}${unmatchedList.length > 8 ? "…" : ""}
          <div style="margin-top:9px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="cg-autocreate" checked style="width:16px;height:16px;accent-color:var(--gold)"> <b>Eşleşmeyenleri otomatik cari aç</b> (hiç satır atlanmasın)</label>
            <span style="color:var(--ink-soft)">Grup:</span>
            <select id="cg-autogroup">${mainAccts.map((a) => `<option value="${a.id}" ${a === defGroup ? "selected" : ""}>${esc(a.code)} ${esc(a.name)}</option>`).join("")}</select>
            <button class="btn btn-sm" id="cg-dlunmatched" type="button">⬇️ Eşleşmeyenleri indir (CSV)</button>
          </div></div>` : `<div class="notice info" style="margin-bottom:10px">✅ Tüm şahıslar mevcut hesaplarla eşleşti.</div>`}
        <div class="table-wrap"><table class="data">
          <thead><tr>
            <th>Cari Hesap</th><th>Cari No</th><th>Tarih</th><th>Şahıs</th><th>Açıklama</th><th>Rapor</th>
            <th class="num">Borç</th><th class="num">Alacak</th><th>Fatura</th><th>Fatura No</th>
          </tr></thead>
          <tbody>${preview.map(({ acc, r }) => `<tr>
            <td>${esc(acc.code || "")} ${esc(acc.name || "")}</td>
            <td>${esc(r.cariNo)}</td>
            <td>${r.date ? fmtDate(r.date) : '<span style="color:var(--danger)">—</span>'}</td>
            <td>${esc(r.sahis)}</td><td>${esc(r.aciklama)}</td><td>${esc(r.rapor)}</td>
            <td class="num">${r.borc ? fmtTRY(r.borc) : "—"}</td>
            <td class="num">${r.alacak ? fmtTRY(r.alacak) : "—"}</td>
            <td>${esc(r.faturaTuru)}</td><td>${esc(r.faturaNo)}</td>
          </tr>`).join("")}</tbody>
        </table></div>
        ${matchedRows > 60 ? `<div class="pv-fhint">İlk 60 satır gösteriliyor; hepsi aktarılacak.</div>` : ""}
      </div>
      <div class="pv-cta"><div class="grow"></div>
        <button class="btn btn-primary" id="cg-save">✓ Hareketleri İçe Aktar</button></div>`;

    // Eşleşmeyenleri CSV indir — her şahsın en yakın mevcut hesabı + benzerlik %
    const dlBtn = $("#cg-dlunmatched", editor);
    if (dlBtn) dlBtn.onclick = () => {
      const lb = loadingBar("Analiz ediliyor…");
      try {
        const tok = (s) => new Set(normTr(s).split(/[^0-9a-z]+/).filter(Boolean));
        const accToks = cariAccounts.map((a) => ({ a, t: tok(a.name) }));
        const best = (name) => {
          const st = tok(name); let ba = null, bs = 0;
          for (const { a, t } of accToks) {
            let inter = 0; st.forEach((x) => { if (t.has(x)) inter++; });
            const uni = st.size + t.size - inter;
            const sc = uni ? inter / uni : 0;
            if (sc > bs) { bs = sc; ba = a; }
          }
          return { ba, bs };
        };
        const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const lines = [["Sahis", "SatirSayisi", "Normalize", "EnYakinKod", "EnYakinHesapAdi", "Benzerlik%", "yapılacaklar"].map(q).join(";")];
        unmatchedList.forEach((u) => {
          const { ba, bs } = best(u.name);
          lines.push([u.name, u.rows.length, normTr(u.name), ba ? ba.code : "", ba ? ba.name : "", Math.round(bs * 100), ""].map(q).join(";"));
        });
        const csv = "﻿" + lines.join("\r\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = `eslesmeyen-cariler-${todayISO()}.csv`; a.click();
        URL.revokeObjectURL(url);
        lb.finish(() => toast(`${unmatchedList.length} eşleşmeyen şahıs indirildi.`, "ok"));
      } catch (e) { lb.finish(); toast("İndirilemedi: " + e.message, "err"); }
    };

    const autoOn = () => !!$("#cg-autocreate", editor)?.checked;
    const saveBtn = $("#cg-save", editor);
    const refreshBtn = () => {
      const n = matchedRows + (autoOn() ? unmatchedRows : 0);
      saveBtn.textContent = `✓ ${n.toLocaleString("tr-TR")} Hareketi İçe Aktar`;
    };
    refreshBtn();
    const acEl = $("#cg-autocreate", editor);
    if (acEl) acEl.addEventListener("change", refreshBtn);

    saveBtn.onclick = () => {
      const autocreate = autoOn();
      const groupId = $("#cg-autogroup", editor)?.value || null;
      const willRows = matchedRows + (autocreate ? unmatchedRows : 0);
      const grp = mainAccts.find((a) => a.id === groupId);
      confirmDialog(
        `${willRows.toLocaleString("tr-TR")} hareket aktarılacak (açılış 0).` +
        (unmatchedRows
          ? (autocreate
              ? ` ${unmatchedList.length} yeni cari otomatik açılacak (${grp ? esc(grp.code + " " + grp.name) : "grup"} altında).`
              : ` ${unmatchedRows.toLocaleString("tr-TR")} eşleşmeyen satır ATLANACAK.`)
          : "") +
        (priorCount ? ` Önceki ${priorCount.toLocaleString("tr-TR")} cari geçmişi silinecek.` : "") +
        ` Devam edilsin mi?`,
        () => doImport(byAcc, unmatched, autocreate, groupId, total));
    };
  }

  async function doImport(byAcc, unmatched, autocreate, groupId, readTotal) {
    const pb = progressBar("Cari geçmişi aktarılıyor…");
    try {
      // 0) Eşleşmeyen şahıslar için otomatik cari aç (programda olmayan cari kalmasın)
      let createdAccts = 0;
      if (autocreate && unmatched && unmatched.size) {
        const parent = accounts.find((a) => a.id === groupId && !a.parentId)
          || accounts.find((a) => String(a.code) === "320" && !a.parentId);
        if (parent) {
          pb.set(2, `${unmatched.size} yeni cari açılıyor…`);
          let cnt = accounts.filter((a) => a.parentCode === parent.code)
            .reduce((m, a) => { const n = parseInt(String(a.code || "").split(".")[1], 10); return isNaN(n) ? m : Math.max(m, n); }, 0);
          for (const u of unmatched.values()) {
            cnt++;
            const code = `${parent.code}.${String(cnt).padStart(2, "0")}`;
            const payload = { code, name: titleCase(u.name), type: parent.type, parentId: parent.id, parentCode: parent.code, vkn: "", extNo: "", openingBalance: 0, createdAt: serverTimestamp() };
            const ref = await addDoc(C.accounts(), payload);
            const acc = { id: ref.id, ...payload };
            accounts.push(acc);
            byAcc.set(acc.id, { acc, rows: u.rows });
            createdAccts++;
          }
        }
      }
      // 1) Önceki cari-gecmis kayıtlarını sil (hepsi — tam yenileme)
      const stale = priorEntries.filter((e) => e.source === CARI_SRC);
      if (stale.length) {
        pb.set(3, `${stale.length.toLocaleString("tr-TR")} eski kayıt siliniyor…`);
        for (let i = 0; i < stale.length; i += 400) {
          const bt = writeBatch(db);
          stale.slice(i, i + 400).forEach((e) => bt.delete(doc(db, "accountEntries", e.id)));
          await bt.commit();
        }
      }

      // 2) Her cari: açılış 0 + hareketler (İşlem No hesap başına 1…N)
      const now = new Date().toISOString();
      const docs = [];
      for (const { acc, rows } of byAcc.values()) {
        await updateDoc(doc(db, "accounts", acc.id), { openingBalance: 0 });
        rows.forEach((r, i) => docs.push({
          accountId: acc.id, accountCode: String(acc.code || ""),
          islemNo: i + 1, cariNo: r.cariNo, date: r.date, sahis: r.sahis,
          aciklama: r.aciklama, rapor: r.rapor, borc: r.borc || 0, alacak: r.alacak || 0,
          faturaTuru: r.faturaTuru, faturaNo: r.faturaNo,
          source: CARI_SRC, createdAt: now,
        }));
      }

      const total = docs.length;
      for (let i = 0; i < total; i += 400) {
        const bt = writeBatch(db);
        docs.slice(i, i + 400).forEach((d) => bt.set(doc(C.accountEntries()), d));
        await bt.commit();
        const done = Math.min(i + 400, total);
        pb.set(8 + Math.round((done / total) * 90), `${done.toLocaleString("tr-TR")} / ${total.toLocaleString("tr-TR")}`);
      }

      // ── DOĞRULAMA: DB'ye yazılan hareket sayısı = aktarılması gereken; veri kaybı yok ──
      const check = await fetchAll(C.accountEntries).catch(() => []);
      const wrote = check.filter((e) => e.source === CARI_SRC).length;
      const lost = Math.max(0, (readTotal || total) - total);   // dosyada olup aktarılmayan satır
      const ok = wrote === total && lost === 0;

      await logAction("İçe Aktarma", "Cari Geçmişi", `${total} hareket · ${byAcc.size} cari${createdAccts ? ` · ${createdAccts} yeni cari` : ""}${ok ? "" : " · ⚠️ doğrulama"}`);
      pb.done(() => {
        if (!ok) toast(`⚠️ Doğrulama: okunan ${(readTotal || total).toLocaleString("tr-TR")}, yazılan ${wrote.toLocaleString("tr-TR")}${lost ? `, ${lost.toLocaleString("tr-TR")} atlandı` : ""}. Kontrol edin.`, "err");
        successAnim(
          (ok ? "✅ " : "⚠️ ") + `${total.toLocaleString("tr-TR")} hareket · ${byAcc.size.toLocaleString("tr-TR")} cari${createdAccts ? ` · ${createdAccts} yeni cari` : ""}` + (ok ? " · veri kaybı yok" : ""),
          () => { location.hash = "#/hesaplar"; });
      });
    } catch (e) {
      pb.done(() => toast("Hata: " + e.message, "err"));
    }
  }
}

async function viewAccountLedger(c) {
  const id = hashQuery("id");
  const [accounts, entries] = await Promise.all([
    fetchAll(C.accounts),
    fetchAll(C.accountEntries).catch(() => []),
  ]);
  const acc = accounts.find((a) => a.id === id);
  if (!acc) {
    c.innerHTML = `<div class="notice warn">Hesap bulunamadı. <a href="#/hesaplar">← Hesaplara dön</a></div>`;
    return;
  }
  const cari = isCari(acc.type) || String(acc.code || "").startsWith("108");
  const list = entries.filter((e) => e.accountId === id)
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.islemNo || 0) - (b.islemNo || 0));
  const opening = acc.openingBalance ?? acc.balance ?? 0;
  let run = opening;
  const rows = list.map((e) => {
    run += cari ? (parseNum(e.borc) - parseNum(e.alacak)) : (parseNum(e.giren) - parseNum(e.cikan));
    return { e, bakiye: run };
  });
  const nextNo = entries.reduce((m, e) => Math.max(m, e.islemNo || 0), 0) + 1;
  const nextCariNo = cari ? (list.reduce((m, e) => Math.max(m, e.cariNo || 0), 0) + 1) : null;

  // Aktarım incelemesinde: bu turda eklenen kayıtlar sarı vurgulanır
  const hlTok = reviewQueue && reviewQueue.tok;
  const isHl = (e) => !!(hlTok && e.impTok === hlTok);

  // Mobil: banka uygulaması tarzı hareket kartları
  const ledgerEmpty = `<div class="empty" style="padding:28px"><div class="ico">🧾</div><p>Henüz hareket yok. <b>+ Yeni Hareket</b> ile ekleyin.</p></div>`;
  const kasaCard = ({ e, bakiye }) => `
    <button class="tx-card${isHl(e) ? " tx-hl" : ""}" data-edit="${e.id}">
      <div class="tx-left">
        <div class="tx-title">${esc(e.sahis || e.islemAdi || "Hareket")}</div>
        ${e.sahis
          ? `<div class="tx-desc">${esc(e.islemAdi || "Hareket")}</div>`
          : (e.aciklama ? `<div class="tx-desc">${esc(e.aciklama)}</div>` : "")}
        <div class="tx-sub">${fmtDate(e.date)}${e.rapor ? " · " + esc(e.rapor) : ""}</div>
      </div>
      <div class="tx-right">
        ${e.giren ? `<div class="tx-amt in">+${fmtTRY(parseNum(e.giren))}</div>` : ""}
        ${e.cikan ? `<div class="tx-amt out">−${fmtTRY(parseNum(e.cikan))}</div>` : ""}
        <div class="tx-bal">Bakiye ${fmtTRY(bakiye)}</div>
      </div>
    </button>`;
  const cariCard = ({ e, bakiye }) => `
    <button class="tx-card${isHl(e) ? " tx-hl" : ""}" data-edit="${e.id}">
      <div class="tx-left">
        <div class="tx-title">${esc(e.sahis || e.aciklama || "Hareket")}</div>
        ${e.aciklama && e.sahis ? `<div class="tx-desc">${esc(e.aciklama)}</div>` : ""}
        ${(e.faturaTuru || e.faturaNo) ? `<div class="tx-tag">🧾 ${esc(e.faturaTuru || "")}${e.faturaNo ? " · " + esc(e.faturaNo) : ""}</div>` : ""}
        <div class="tx-sub">${fmtDate(e.date)}</div>
      </div>
      <div class="tx-right">
        ${e.borc ? `<div class="tx-amt out">Borç ${fmtTRY(parseNum(e.borc))}</div>` : ""}
        ${e.alacak ? `<div class="tx-amt in">Alacak ${fmtTRY(parseNum(e.alacak))}</div>` : ""}
        <div class="tx-bal">Bakiye ${fmtTRY(bakiye)}</div>
      </div>
    </button>`;

  // Aktarım sonrası inceleme turu bandı (bu hesap sıradaysa)
  const inReview = reviewQueue && reviewQueue.ids[reviewQueue.index] === acc.id;
  const reviewBar = inReview ? `
    <div class="notice info" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <span><b>${esc(acc.name || "")}</b> cari hesabına bakıldı. Bir sonrakine bakılsın mı?
        <span style="color:var(--ink-faint)">(${reviewQueue.index + 1}/${reviewQueue.ids.length})</span></span>
      <div class="grow"></div>
      <button class="btn btn-sm" id="rev-finish">Bitir</button>
      <button class="btn btn-primary btn-sm" id="rev-next">Sonraki ↵</button>
    </div>` : "";


  // Tablo satırı üreticileri (sayfalama için ayrı)
  const cariRowHtml = ({ e, bakiye }) => `<tr class="${isHl(e) ? "hl-row" : ""}">
    <td><b>${esc(String(e.islemNo ?? "—"))}</b></td>
    <td>${esc(String(e.cariNo ?? "—"))}</td>
    <td>${fmtDate(e.date)}</td>
    <td>${esc(e.sahis || "")}</td>
    <td class="tdwrap">${esc(e.aciklama || "")}</td>
    <td class="num">${e.borc ? fmtTRY(parseNum(e.borc)) : "—"}</td>
    <td class="num">${e.alacak ? fmtTRY(parseNum(e.alacak)) : "—"}</td>
    <td class="num" style="font-weight:700;color:${bakiye<0?'var(--danger)':'inherit'}">${fmtTRY(bakiye)}</td>
    <td>${esc(e.faturaTuru || "")}</td>
    <td>${esc(e.faturaNo || "")}</td>
    <td style="text-align:right"><button class="btn btn-sm" data-edit="${e.id}">Düzenle</button></td>
  </tr>`;
  const kasaRowHtml = ({ e, bakiye }) => `<tr class="${isHl(e) ? "hl-row" : ""}">
    <td><b>${esc(String(e.islemNo ?? "—"))}</b></td>
    <td>${fmtDate(e.date)}</td>
    <td>${esc(e.islemAdi || "")}</td>
    <td>${esc(e.sahis || "")}</td>
    <td class="tdwrap">${esc(e.aciklama || "")}</td>
    <td>${esc(e.rapor || "")}</td>
    <td class="num" style="color:var(--ok)">${e.giren ? fmtTRY(parseNum(e.giren)) : "—"}</td>
    <td class="num" style="color:var(--danger)">${e.cikan ? fmtTRY(parseNum(e.cikan)) : "—"}</td>
    <td class="num" style="font-weight:700;color:${bakiye<0?'var(--danger)':'inherit'}">${fmtTRY(bakiye)}</td>
    <td style="text-align:right"><button class="btn btn-sm" data-edit="${e.id}">Düzenle</button></td>
  </tr>`;
  const rowHtml = cari ? cariRowHtml : kasaRowHtml;
  const cardHtml = cari ? cariCard : kasaCard;

  const totBorc = list.reduce((s, e) => s + parseNum(e.borc), 0);
  const totAlacak = list.reduce((s, e) => s + parseNum(e.alacak), 0);
  const totGiren = list.reduce((s, e) => s + parseNum(e.giren), 0);
  const totCikan = list.reduce((s, e) => s + parseNum(e.cikan), 0);

  const hero = cari
    ? `<div class="ledger-hero">
        <div class="lh-ico">${accEmoji(acc)}</div>
        <div class="lh-mid"><div class="lh-code">${esc(acc.code || "")}</div><div class="lh-name">${esc(acc.name || "")}</div></div>
        <div class="lh-bal"><div class="lbl">${run >= 0 ? "Borç" : "Alacak"} Bakiye</div><div class="val">${fmtTRY(Math.abs(run))}</div></div>
      </div>`
    : `<div class="ledger-hero">
        <div class="lh-ico">${accEmoji(acc)}</div>
        <div class="lh-mid"><div class="lh-code">${esc(acc.code || "")}</div><div class="lh-name">${esc(acc.name || "")}</div></div>
        <div class="lh-bal"><div class="lbl">Güncel Bakiye</div><div class="val" ${run < 0 ? 'style="color:#ffd9d0"' : ""}>${fmtTRY(run)}</div></div>
      </div>`;
  const thead = cari
    ? `<tr><th>İşlem No</th><th>Cari No</th><th>Tarih</th><th>Şahıs</th><th>Açıklama</th><th class="num">Borç</th><th class="num">Alacak</th><th class="num">Güncel Bakiye</th><th>Fatura Türü</th><th>Fatura No</th><th></th></tr>`
    : `<tr><th>İşlem No</th><th>Tarih</th><th>İşlem Adı</th><th>Şahıs</th><th>Açıklama</th><th>Rapor</th><th class="num">Giren Tutar</th><th class="num">Çıkan Tutar</th><th class="num">Güncel Bakiye</th><th></th></tr>`;
  const colCount = cari ? 11 : 10;
  // Sabit sütun genişlikleri — sayfalar arası "başlık daralması" olmasın (Açıklama esner/wrap)
  const colgroup = cari
    ? `<colgroup><col style="width:66px"><col style="width:70px"><col style="width:92px"><col style="width:150px"><col><col style="width:150px"><col style="width:150px"><col style="width:150px"><col style="width:120px"><col style="width:110px"><col style="width:96px"></colgroup>`
    : `<colgroup><col style="width:66px"><col style="width:92px"><col style="width:120px"><col style="width:150px"><col><col style="width:130px"><col style="width:150px"><col style="width:150px"><col style="width:150px"><col style="width:96px"></colgroup>`;
  const tfoot = !rows.length ? "" : (cari
    ? `<tfoot><tr style="font-weight:700;background:var(--surface-2)"><td colspan="7">Toplam</td><td class="num">${fmtTRY(run)}</td><td colspan="3"></td></tr></tfoot>`
    : `<tfoot><tr style="font-weight:700;background:var(--surface-2)"><td colspan="8">Toplam</td><td class="num">${fmtTRY(run)}</td><td></td></tr></tfoot>`);

  // Arama için her satıra metin torbası (bir kez hesaplanır — 27.000'de bile hızlı)
  rows.forEach((r) => {
    const e = r.e;
    r._hay = normTr([
      e.islemNo, e.cariNo, e.islemAdi, e.sahis, e.aciklama, e.rapor, e.faturaTuru, e.faturaNo,
      fmtDate(e.date),
      e.giren ? fmtNum(parseNum(e.giren)) : "", e.cikan ? fmtNum(parseNum(e.cikan)) : "",
      e.borc ? fmtNum(parseNum(e.borc)) : "", e.alacak ? fmtNum(parseNum(e.alacak)) : "",
    ].filter((x) => x !== "" && x != null).join(" "));
  });

  // Sayfalama + filtre: çok satırlı defterlerde (ör. 27.000) yalnız bir dilim çizilir
  const PAGE_SIZE = 100;
  const tp = () => Math.max(1, Math.ceil(view.length / PAGE_SIZE));  // toplam sayfa (görünen kümeye göre)
  let view = rows;                                                   // filtreli küme (başta hepsi)
  const hlIdx = hlTok ? rows.findIndex(({ e }) => isHl(e)) : -1;
  let page = hlIdx >= 0 ? Math.floor(hlIdx / PAGE_SIZE) : tp() - 1;  // vurgu varsa o sayfa, yoksa en yeni

  // Arama + tarih + sayfalama tek satırda; sayfalama ortada no, iki yanında ok
  const toolsHtml = `
    <div class="tbl-tools">
      <input class="tbl-search" type="search" placeholder="🔍 Ara — açıklama, şahıs, rapor, tutar…" autocomplete="off" />
      <span class="tbl-lbl">Tarih</span>
      <input class="tbl-date tbl-from" type="date" aria-label="Başlangıç tarihi" />
      <span class="tbl-dsep">—</span>
      <input class="tbl-date tbl-to" type="date" aria-label="Bitiş tarihi" />
      <button class="btn btn-sm tbl-clear">Temizle</button>
      <div class="pager pager-mini">
        <button class="btn btn-sm" data-pg="prev" aria-label="Önceki">‹</button>
        <span class="pg-info"></span>
        <button class="btn btn-sm" data-pg="next" aria-label="Sonraki">›</button>
      </div>
    </div>`;

  c.innerHTML = `<div class="ledger-view">` + reviewBar + hero + `
    <div class="card ledger-card">
      <div class="card-head"><h3>${cari ? "Cari Hareketler" : "Hareketler"}</h3><span class="hint">${list.length.toLocaleString("tr-TR")} hareket</span></div>
      ${rows.length ? toolsHtml : ""}
      <div class="ledger-cards"></div>
      <div class="table-wrap ledger-table"><table class="data">
        ${colgroup}
        <thead>${thead}</thead>
        <tbody></tbody>
        ${tfoot}
      </table></div>
    </div></div>`;

  const cardsEl = $(".ledger-cards", c);
  const tbodyEl = $(".ledger-table tbody", c);
  const searchEl = $(".tbl-search", c), fromEl = $(".tbl-from", c), toEl = $(".tbl-to", c);
  const clearEl = $(".tbl-clear", c);
  const wireEdits = () => $$("[data-edit]", c).forEach((b) => b.onclick = () =>
    entryModal(acc, list.find((e) => e.id === b.dataset.edit), { nextNo, nextCariNo }));

  function renderPage() {
    const totalPages = tp();
    page = Math.max(0, Math.min(totalPages - 1, page));
    if (!view.length) {
      const msg = rows.length ? "Eşleşen hareket yok." : "Henüz hareket yok.";
      cardsEl.innerHTML = `<div class="empty" style="padding:28px"><div class="ico">🔍</div><p>${msg}</p></div>`;
      tbodyEl.innerHTML = `<tr><td colspan="${colCount}"><div class="empty"><div class="ico">🔍</div><p>${msg}</p></div></td></tr>`;
    } else {
      const start = page * PAGE_SIZE;
      const slice = view.slice(start, start + PAGE_SIZE);
      cardsEl.innerHTML = slice.map(cardHtml).join("");
      tbodyEl.innerHTML = slice.map(rowHtml).join("");
    }
    $$(".pg-info", c).forEach((el) => el.textContent = `${page + 1}/${totalPages}`);
    $$(".pager", c).forEach((p) => p.style.display = totalPages > 1 ? "" : "none");
    $$("[data-pg]", c).forEach((b) => {
      b.disabled = (b.dataset.pg === "first" || b.dataset.pg === "prev") ? page === 0 : page === totalPages - 1;
    });
    wireEdits();
  }

  function applyFilter() {
    const q = normTr(searchEl.value.trim());
    const f = fromEl.value, t = toEl.value;   // "" ya da YYYY-MM-DD
    view = rows.filter((r) => {
      if (q && !r._hay.includes(q)) return false;
      if (f && (!r.e.date || r.e.date < f)) return false;
      if (t && (!r.e.date || r.e.date > t)) return false;
      return true;
    });
    page = 0;                                 // filtre değişince başa dön
    renderPage();
    const tw = $(".ledger-table", c); if (tw) tw.scrollTop = 0;
  }

  let deb;
  if (searchEl) searchEl.addEventListener("input", () => { clearTimeout(deb); deb = setTimeout(applyFilter, 140); });
  if (fromEl) fromEl.addEventListener("change", applyFilter);
  if (toEl) toEl.addEventListener("change", applyFilter);
  if (clearEl) clearEl.addEventListener("click", () => {
    searchEl.value = ""; fromEl.value = ""; toEl.value = ""; applyFilter(); searchEl.focus();
  });

  $$("[data-pg]", c).forEach((b) => b.onclick = () => {
    const k = b.dataset.pg;
    page = k === "first" ? 0 : k === "last" ? tp() - 1 : k === "prev" ? page - 1 : page + 1;
    renderPage();
    const tw = $(".ledger-table", c); if (tw) tw.scrollTop = 0;
  });
  renderPage();

  // Defteri ekrana kilitle: yalnız tablo içi kayar, sayfa kaymaz (masaüstü).
  // Mobilde tablo gizli (kartlar akar) → kilit uygulanmaz.
  const ledgerRoot = $(".ledger-view", c), twFit = $(".ledger-table", c);
  function fitLedger() {
    if (!ledgerRoot) return;
    ledgerRoot.style.height = ""; ledgerRoot.style.overflow = "";
    if (!twFit || getComputedStyle(twFit).display === "none") return;
    const content = c.closest(".content");
    const padB = content ? (parseFloat(getComputedStyle(content).paddingBottom) || 0) : 0;
    const h = window.innerHeight - ledgerRoot.getBoundingClientRect().top - padB - 4;
    if (h > 240) { ledgerRoot.style.height = h + "px"; ledgerRoot.style.overflow = "hidden"; }
  }
  requestAnimationFrame(fitLedger);
  setTimeout(fitLedger, 300);   // geçiş animasyonu bitince kesin ölçü
  ledgerFitHandler = fitLedger;
  window.addEventListener("resize", fitLedger);

  // Sarı vurgulanan (bu turda eklenen) ilk kayda kaydır
  if (hlTok) requestAnimationFrame(() => {
    const first = $(".tx-hl", c) || $(".hl-row", c);
    if (first) first.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  // İnceleme turu: Sonraki / Bitir + Enter kısayolu
  if (inReview) {
    $("#rev-next").onclick = advanceReview;
    $("#rev-finish").onclick = finishReview;
    reviewKeyHandler = (e) => {
      if (e.key !== "Enter") return;
      if ($("#modal-root").children.length) return;               // pencere açıksa karışma
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;  // yazarken karışma
      e.preventDefault();
      advanceReview();
    };
    document.addEventListener("keydown", reviewKeyHandler);
  }
}

function entryModal(acc, entry, opts) {
  const isNew = !entry;
  const cari = isCari(acc.type);
  const body = document.createElement("div");
  if (cari) {
    body.innerHTML = `
      <div class="form-row">
        <div class="field"><label>İşlem No</label><input id="e-no" value="${esc(String(entry?.islemNo ?? opts?.nextNo ?? ""))}" readonly /></div>
        <div class="field"><label>Cari No</label><input id="e-carino" value="${esc(String(entry?.cariNo ?? opts?.nextCariNo ?? ""))}" readonly /></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Tarih</label><input type="date" id="e-date" value="${esc(entry?.date || todayISO())}" /></div>
        <div class="field"><label>Şahıs</label><input id="e-sahis" value="${esc(entry?.sahis || "")}" placeholder="Kişi / firma" /></div>
      </div>
      <div class="field"><label>Açıklama</label><textarea id="e-aciklama" rows="2" placeholder="Açıklama...">${esc(entry?.aciklama || "")}</textarea></div>
      <div class="form-row">
        ${moneyField("Borç", "e-borc", entry?.borc ?? "")}
        ${moneyField("Alacak", "e-alacak", entry?.alacak ?? "")}
      </div>
      <div class="form-row">
        <div class="field"><label>Fatura Türü</label><select id="e-faturaturu">
          ${FATURA_TURU.map((t) => `<option value="${esc(t)}" ${entry?.faturaTuru===t?"selected":""}>${t || "—"}</option>`).join("")}
        </select></div>
        <div class="field"><label>Fatura No</label><input id="e-faturano" value="${esc(entry?.faturaNo || "")}" placeholder="Örn. A-000123" /></div>
      </div>`;
  } else {
    body.innerHTML = `
      <div class="form-row">
        <div class="field"><label>İşlem No</label><input id="e-no" value="${esc(String(entry?.islemNo ?? opts?.nextNo ?? ""))}" readonly /></div>
        <div class="field"><label>Tarih</label><input type="date" id="e-date" value="${esc(entry?.date || todayISO())}" /></div>
      </div>
      <div class="field"><label>İşlem Adı</label><input id="e-islem" value="${esc(entry?.islemAdi || "")}" placeholder="Örn. Tahsilat / Ödeme / Gün Sonu" /></div>
      <div class="form-row">
        <div class="field"><label>Şahıs</label><input id="e-sahis" value="${esc(entry?.sahis || "")}" placeholder="Kişi / firma" /></div>
        <div class="field"><label>Rapor</label><input id="e-rapor" value="${esc(entry?.rapor || "")}" placeholder="Rapor / referans" /></div>
      </div>
      <div class="field"><label>Açıklama</label><textarea id="e-aciklama" rows="2" placeholder="Açıklama...">${esc(entry?.aciklama || "")}</textarea></div>
      <div class="form-row">
        ${moneyField("Giren Tutar", "e-giren", entry?.giren ?? "")}
        ${moneyField("Çıkan Tutar", "e-cikan", entry?.cikan ?? "")}
      </div>`;
  }
  wireMoney(body);
  const footer = [];
  if (!isNew) {
    const del = mkBtn("🗑️ Sil", "btn-danger", () =>
      confirmDialog("Hareket silinsin mi?", async () => {
        await deleteDoc(doc(db, "accountEntries", entry.id));
        await logAction("Silme", "Hesap Hareketi", `${acc.code || ""} ${acc.name || ""} · İşlem No ${entry.islemNo ?? ""}`);
        m.close(); toast("Silindi.", "ok"); route();
      }));
    del.style.marginRight = "auto";
    footer.push(del);
  }
  footer.push(mkBtn("Vazgeç", "", () => m.close()));
  footer.push(mkBtn("Kaydet", "btn-primary", async () => {
    const base = {
      accountId: acc.id, accountCode: acc.code || "",
      islemNo: parseInt($("#e-no", body).value) || (entry?.islemNo ?? opts?.nextNo),
      date: $("#e-date", body).value || todayISO(),
      sahis: $("#e-sahis", body).value.trim(),
      aciklama: $("#e-aciklama", body).value.trim(),
      updatedAt: serverTimestamp(),
    };
    let payload;
    if (cari) {
      const borc = parseNum($("#e-borc", body).value);
      const alacak = parseNum($("#e-alacak", body).value);
      if (!borc && !alacak) return toast("Borç ya da alacak tutarı girin.", "err");
      payload = {
        ...base,
        cariNo: parseInt($("#e-carino", body).value) || (entry?.cariNo ?? opts?.nextCariNo),
        borc, alacak,
        faturaTuru: $("#e-faturaturu", body).value,
        faturaNo: $("#e-faturano", body).value.trim(),
      };
    } else {
      const giren = parseNum($("#e-giren", body).value);
      const cikan = parseNum($("#e-cikan", body).value);
      if (!giren && !cikan) return toast("Giren ya da çıkan tutar girin.", "err");
      payload = {
        ...base,
        islemAdi: $("#e-islem", body).value.trim(),
        rapor: $("#e-rapor", body).value.trim(),
        giren, cikan,
      };
    }
    try {
      const lbl = `${acc.code || ""} ${acc.name || ""} · İşlem No ${payload.islemNo ?? ""}`;
      if (isNew) {
        // Uyarı: aynı hesapta aynı tarih ve aynı tutarda işlem zaten var mı?
        const amt = cari ? (payload.borc || payload.alacak) : (payload.giren || payload.cikan);
        const all = await fetchAll(C.accountEntries).catch(() => []);
        const dup = amt && all.some((e) => e.accountId === acc.id && e.date === payload.date && (cari
          ? (parseNum(e.borc) === payload.borc && parseNum(e.alacak) === payload.alacak)
          : (parseNum(e.giren) === payload.giren && parseNum(e.cikan) === payload.cikan)));
        if (dup && !confirm(`Bu hesapta ${fmtDate(payload.date)} tarihli ve aynı tutarlı bir işlem zaten var.\nYine de eklensin mi?`)) return;
        await addDoc(C.accountEntries(), { ...payload, createdAt: serverTimestamp(), createdBy: currentUser.email });
        await logAction("Ekleme", "Hesap Hareketi", lbl);
      } else {
        await updateDoc(doc(db, "accountEntries", entry.id), payload);
        await logAction("Düzenleme", "Hesap Hareketi", lbl);
      }
      m.close(); toast("Kaydedildi.", "ok"); route();
    } catch (e) { toast("Hata: " + e.message, "err"); }
  }));
  const m = openModal({
    title: isNew ? (cari ? "Yeni Cari Hareket" : "Yeni Hareket") : `Hareket · İşlem No ${entry.islemNo ?? ""}`,
    body, footer,
  });
  $(".modal", $("#modal-root")).style.maxWidth = "560px";
}

// ===========================================================================
//  MODÜL: CARİ HAREKET İŞLEME (Uyumsoft Excel)
// ===========================================================================
async function viewCariHareket(c) {
  const nrm = (s) => String(s || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim();

  showChooser();

  // 1) Önce fatura türünü seç → basınca direkt dosya seçme açılır
  function showChooser() {
    c.innerHTML = `
      <div class="card">
        <div class="ft-q">Hangi fatura türünü aktaralım?<small>Türe bas → dosyayı seç → tablo</small></div>
        <div class="ft-cards">
          <button class="ft-c sat" data-kind="satis"><span class="ic">📤</span><span class="t">Satış Faturası</span></button>
          <button class="ft-c al" data-kind="alis"><span class="ic">📥</span><span class="t">Alış Faturası</span></button>
        </div>
      </div>`;
    $$(".ft-c", c).forEach((b) => b.onclick = () => pickFile(b.dataset.kind));
  }

  // 2) Direkt dosya seçtir (drop zone yok); seçilince tabloyu göster
  function pickFile(kind) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".xlsx,.xls,.csv"; input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      const lb = loadingBar("Dosya okunuyor…");
      try {
        const { headers, rows } = await parseSpreadsheet(file);
        if (!rows.length) { lb.finish(); return toast("Veri bulunamadı.", "err"); }
        lb.finish(() => { showEditor(kind); buildPreview(headers, rows, kind); });
      } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
    };
    input.click();
  }

  function showEditor(kind) {
    const label = kind === "alis" ? "📥 Alış Faturası" : "📤 Satış Faturası";
    c.innerHTML = `
      <div class="ch-bar">
        <span class="ch-title">${label}</span>
        <div class="grow"></div>
        <button class="btn btn-sm" id="ch-reup">📄 Başka Dosya</button>
        <button class="btn btn-sm" id="ch-back">← Tür</button>
      </div>
      <div id="ch-editor"></div>`;
    $("#ch-back").onclick = showChooser;
    $("#ch-reup").onclick = () => pickFile(kind);
  }

  async function buildPreview(headers, rows, kind) {
    const targetType = kind === "alis" ? "tedarikci" : "musteri";
    const faturaTuru = kind === "alis" ? "Alış Faturası" : "Satış Faturası";
    const editor = $("#ch-editor");
    editor.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div></div>`;

    const [accounts, entries] = await Promise.all([
      fetchAll(C.accounts).catch(() => []),
      fetchAll(C.accountEntries).catch(() => []),
    ]);
    const main = accounts.find((a) => a.type === targetType && !a.parentId)
              || accounts.find((a) => a.type === targetType);
    if (!main) {
      editor.innerHTML = `<div class="notice warn">⚠️ <b>${kind === "alis" ? "320 Tedarikçiler" : "120 Alıcılar"}</b> ana hesabı yok.
        Önce <a href="#/hesaplar">Hesaplar</a>'dan oluşturun.</div>`;
      return;
    }
    let cariAccounts = accounts.filter((a) => a.type === targetType);

    const col = {
      faturaNo: guessCol(headers, ["fatura no"]),
      date: guessCol(headers, ["fatura tarih"]),
      ad: guessCol(headers, ["cari ad", "cari ünvan", "cari unvan"]),
      vkn: guessCol(headers, ["vkn", "tckn"]),
      amount: guessCol(headers, ["ödenecek miktar"]) || guessCol(headers, ["ödenecek"]),
    };
    const items = rows.map((r) => ({
      faturaNo: String(r[col.faturaNo] ?? "").trim(),
      date: excelDateToISO(r[col.date]),
      ad: String(r[col.ad] ?? "").trim(),
      vkn: String(r[col.vkn] ?? "").trim(),
      amount: parseNum(r[col.amount]),
      durum: "acik",   // açık / kapalı / kısmi
      kismiTutar: 0,   // kısmi kapatta girilen tutar
    })).filter((it) =>
      // Gerçek fatura satırı: fatura no rakam içerir ve VKN ya da tutar var
      // (Başlama/Bitiş/Süre/Belge Sayısı gibi özet satırları elenir)
      /\d/.test(it.faturaNo) && !it.faturaNo.includes(":") && (it.vkn || it.amount));

    // Ad eşleştirme: normTr ile ASCII-katla (ı/i, ş/s, ğ/g… tek biçim), şirket eklerini at, çekirdek isimle karşılaştır
    const CH_STOP = new Set(["a", "s", "as", "anonim", "sirketi", "sti", "ltd", "limited", "san", "sanayi", "tic", "ticaret", "ve", "paz", "pazarlama", "ith", "ihracat", "ihr", "dis", "org"]);
    const chNorm = (s) => normTr(s).replace(/[^0-9a-z ]/g, " ").replace(/\s+/g, " ").trim();
    const chCore = (s) => chNorm(s).split(" ").filter((w) => w.length > 1 && !CH_STOP.has(w)).join(" ");
    const nameMatch = (aName, itAd) => {
      const A = chCore(aName), B = chCore(itAd);
      if (!A || !B) return chNorm(aName) === chNorm(itAd) && !!chNorm(aName);
      if (A === B) return true;
      // Kelime örtüşmesi (sıra/orta kelime önemsiz): kısa ismin çekirdek kelimeleri diğerinde varsa eşleş
      const ta = [...new Set(A.split(" "))], tb = [...new Set(B.split(" "))];
      const setB = new Set(tb);
      const inter = ta.filter((w) => setB.has(w)).length;
      const minLen = Math.min(ta.length, tb.length);
      if (minLen >= 2 && inter >= minLen) return true;        // kısa ismin tüm kelimeleri diğerinde
      if (minLen >= 3 && inter >= minLen - 1) return true;    // 3+ kelimede 1 kelime tolerans
      return false;
    };
    const allCari = accounts.filter((a) => isCari(a.type) && a.parentId);
    const chParentIds = new Set(accounts.map((a) => a.parentId).filter(Boolean));
    const allLeaf = accounts.filter((a) => !chParentIds.has(a.id) && a.code);   // eşleştirmede tüm hesaplar
    const findIn = (pool, it) =>
      (it.vkn && pool.find((a) => a.vkn && String(a.vkn) === it.vkn)) ||
      pool.find((a) => nameMatch(a.name, it.ad) || (a.nameAliases || []).some((al) => nameMatch(al, it.ad))) || null;
    // Elle eşleştirilen (forced) öncelikli; sonra doğru tür (320/120); bulamazsa tüm cari hesaplar
    const findAcc = (it) => it.forced || findIn(cariAccounts, it) || findIn(allCari, it);
    // Elle eşleştir: seçilen hesabı sabitle + fatura adını hesabın alias'ına ekle (kalıcı hafıza)
    async function matchCari(it) {
      openAccountPicker({
        accounts: allLeaf, title: "Hesap Eşleştir", query: "", fixedNewName: it.ad || "",
        onPick: async (res) => {
          if (res.newName) { const acc = await createCari({ ...it, ad: res.newName }, true); it.forced = acc; toast(`Cari eklendi: ${acc.name}`, "ok"); draw(); return; }
          const acc = res.acc; if (!acc) return;
          it.forced = acc;
          const aliases = acc.nameAliases || [];
          if (it.ad && !aliases.some((al) => normTr(al) === normTr(it.ad))) {
            aliases.push(it.ad);
            try { await updateDoc(doc(db, "accounts", acc.id), { nameAliases: aliases }); acc.nameAliases = aliases; } catch (_) {}
          }
          toast(`Eşleştirildi: ${acc.name}`, "ok"); draw();
        },
      });
    }
    const statusOf = (it) => {
      const acc = findAcc(it);
      if (!acc) return { code: "nocari" };
      const dup = it.faturaNo && entries.some((e) => e.accountId === acc.id && String(e.faturaNo || "") === it.faturaNo);
      return { code: dup ? "dup" : "ready", acc };
    };

    async function createCari(it, silent) {
      const siblings = accounts.filter((a) => a.parentId === main.id);
      const code = nextSubCode(main, siblings);
      const payload = {
        code, name: it.ad ? titleCase(it.ad) : "Yeni Cari", type: main.type,
        parentId: main.id, parentCode: main.code, vkn: it.vkn || "",
        openingBalance: 0, createdAt: serverTimestamp(),
      };
      const ref = await addDoc(C.accounts(), payload);
      const newAcc = { id: ref.id, ...payload };
      accounts.push(newAcc); cariAccounts.push(newAcc);
      await logAction("Ekleme", "Cari Hesap", `${code} ${payload.name}`);
      if (!silent) { toast("Cari eklendi: " + payload.name, "ok"); draw(); }
      return newAcc;
    }

    // ---- Olası tekrar cari tespiti (aynı VKN ya da biri diğerinin adının başında) ----
    function detectDupCaris() {
      const out = [], used = new Set();
      const list = cariAccounts.filter((a) => a.parentId);
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          if (used.has(a.id) || used.has(b.id)) continue;
          const va = String(a.vkn || "").trim(), vb = String(b.vkn || "").trim();
          let reason = null;
          if (va && vb && va === vb) reason = "Aynı VKN";
          else {
            const na = nrm(a.name), nb = nrm(b.name);
            if (na && nb && na !== nb && (na.startsWith(nb) || nb.startsWith(na)) && Math.min(na.length, nb.length) >= 3)
              reason = "Benzer ad";
          }
          if (!reason) continue;
          // Kalacak = VKN'si olan; ikisinde de varsa/yoksa uzun (resmi) ad
          let keep = a, drop = b;
          if (vb && !va) { keep = b; drop = a; }
          else if (!!va === !!vb && String(b.name || "").length > String(a.name || "").length) { keep = b; drop = a; }
          out.push({ keep, drop, reason });
          used.add(a.id); used.add(b.id);
        }
      }
      return out;
    }

    async function mergeCari(keep, drop) {
      const es = await fetchAll(C.accountEntries).catch(() => []);
      for (const e of es.filter((x) => x.accountId === drop.id))
        await updateDoc(doc(db, "accountEntries", e.id), { accountId: keep.id });
      if (!String(keep.vkn || "").trim() && String(drop.vkn || "").trim()) {
        await updateDoc(doc(db, "accounts", keep.id), { vkn: drop.vkn });
        keep.vkn = drop.vkn;
      }
      await deleteDoc(doc(db, "accounts", drop.id));
      await logAction("Birleştirme", "Cari Hesap", `${drop.code} ${drop.name} → ${keep.code} ${keep.name}`);
    }

    function openMergeModal(pairs) {
      const body = document.createElement("div");
      body.innerHTML =
        `<div class="mg-note">Aşağıdaki hesaplar aynı cari gibi görünüyor. Onayladıklarında tüm hareketler <b>resmi hesaba</b> taşınır, diğeri silinir.</div>` +
        pairs.map((p, i) => `
          <label class="mg-row">
            <input type="checkbox" class="mg-chk" data-i="${i}" checked />
            <div class="mg-info">
              <div class="mg-drop">${esc(p.drop.code)} · ${esc(p.drop.name)}${p.drop.vkn ? ` · ${esc(p.drop.vkn)}` : ""}</div>
              <div class="mg-arrow">↓ şuraya birleştir</div>
              <div class="mg-keep">${esc(p.keep.code)} · ${esc(p.keep.name)}${p.keep.vkn ? ` · ${esc(p.keep.vkn)}` : ""}</div>
            </div>
            <span class="tag warn mg-reason">${esc(p.reason)}</span>
          </label>`).join("");
      const m = openModal({ title: "Cari Birleştir", body, footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Seçilenleri Birleştir", "btn-primary", async () => {
          const chosen = $$(".mg-chk", body).filter((c) => c.checked).map((c) => pairs[+c.dataset.i]);
          if (!chosen.length) { m.close(); return; }
          m.close();
          for (const p of chosen) await mergeCari(p.keep, p.drop);
          const [fa, fe] = await Promise.all([fetchAll(C.accounts).catch(() => []), fetchAll(C.accountEntries).catch(() => [])]);
          accounts.splice(0, accounts.length, ...fa);
          entries.splice(0, entries.length, ...fe);
          cariAccounts = accounts.filter((a) => a.type === targetType);
          toast(`${chosen.length} cari birleştirildi.`, "ok");
          draw();
        }),
      ] });
    }

    // Borç/Alacak, faturanın türü ve durumuna göre
    const amountsOf = (it) => {
      const closed = it.durum === "kapali" ? it.amount : it.durum === "kismi" ? (it.kismiTutar || 0) : 0;
      return kind === "satis" ? { borc: it.amount, alacak: closed } : { borc: closed, alacak: it.amount };
    };
    const durumInfo = (it) => it.durum === "kapali" ? { label: "Kapalı", tag: "ok" }
      : it.durum === "kismi" ? { label: `Kısmi ${fmtTRY(it.kismiTutar || 0)}`, tag: "gold" }
      : { label: "Açık", tag: "warn" };
    const nonDupIdx = () => items.map((it, i) => i).filter((i) => statusOf(items[i]).code !== "dup");
    let statusFilter = null;   // null | "ready" | "dup" | "nocari"
    const shortNo = (no) => (no && no.length > 11) ? no.slice(0, 3) + "…" + no.slice(-4) : (no || "");

    // Sıra sıra soran sihirbaz: Açık / Kapalı / Kısmi Kapat
    function runWizard(indices) {
      if (!indices.length) { draw(); return; }
      let k = 0, keyH = null;
      const body = document.createElement("div");
      const clearHl = () => $$("[data-row].active", editor).forEach((r) => r.classList.remove("active"));
      const finish = () => { if (keyH) document.removeEventListener("keydown", keyH); clearHl(); m.close(); draw(); };
      const m = openModal({ title: "Fatura Durumu", body, footer: [mkBtn("Bitir", "", finish)] });
      // Sıradaki faturayı listede renkle vurgula (kart + tablo, görünen olana kaydır)
      const hl = (idx) => {
        clearHl();
        const els = $$(`[data-row="${idx}"]`, editor);
        els.forEach((el) => el.classList.add("active"));
        const vis = els.find((el) => el.offsetParent !== null);
        if (vis) vis.scrollIntoView({ block: "center", behavior: "smooth" });
      };
      const choose = (w, amt) => {
        const it = items[indices[k]];
        it.durum = w;
        it.kismiTutar = w === "kismi" ? Math.min(amt || 0, it.amount) : 0;
        k++; step();
      };
      function step() {
        if (k >= indices.length) { finish(); return; }
        const it = items[indices[k]];
        hl(indices[k]);
        const pct = Math.round((k / indices.length) * 100);
        body.innerHTML = `
          <div style="font-size:12px;color:var(--ink-faint)">${k + 1}/${indices.length}</div>
          <div style="font-weight:700;font-size:15px;margin-top:4px">${esc(titleCase(it.ad || "-"))}</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 14px">${esc(it.faturaNo)} · ${fmtDate(it.date)} · Tutar <b>${fmtTRY(it.amount)}</b></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${kind === "satis"
              ? `<button class="btn btn-primary" data-w="kapali">Kapalı ↵</button>
                 <button class="btn" data-w="acik">Açık</button>`
              : `<button class="btn btn-primary" data-w="acik">Açık ↵</button>
                 <button class="btn" data-w="kapali">Kapalı</button>`}
            <button class="btn" data-w="kismi">Kısmi Kapat</button>
          </div>
          <div id="wz-kismi" style="display:none;margin-top:14px">
            ${moneyField(kind === "satis" ? "Tahsil Edilen (Alacak)" : "Ödenen (Borç)", "wz-amount", "")}
            <button class="btn btn-primary btn-sm" id="wz-ok">Devam</button>
          </div>
          <div class="wz-prog"><div class="bar" style="width:${pct}%"></div></div>
          <div class="wz-plabel">${k}/${indices.length} tamamlandı</div>`;
        wireMoney(body);
        $$("[data-w]", body).forEach((b) => b.onclick = () => {
          if (b.dataset.w === "kismi") { $("#wz-kismi", body).style.display = "block"; $("#wz-amount", body).focus(); return; }
          choose(b.dataset.w);
        });
        $("#wz-ok", body).onclick = () => {
          const amt = parseNum($("#wz-amount", body).value);
          if (!amt) return toast("Kapatılan tutarı girin.", "err");
          choose("kismi", amt);
        };
      }
      keyH = (e) => {
        if (e.key !== "Enter") return;
        const p = $("#wz-kismi", body);
        if (p && p.style.display !== "none") { e.preventDefault(); $("#wz-ok", body).click(); return; }
        e.preventDefault(); choose(kind === "satis" ? "kapali" : "acik");
      };
      document.addEventListener("keydown", keyH);
      step();
    }
    const askOne = (i) => runWizard([i]);

    function draw() {
      const st = items.map(statusOf);
      const ready = st.filter((s) => s.code === "ready").length;
      const dups = st.filter((s) => s.code === "dup").length;
      const noc = st.filter((s) => s.code === "nocari").length;
      const dupCaris = detectDupCaris();
      const processable = ready + noc;

      const segs = [
        { code: "ready", w: "İşlenecek", c: "ok", n: ready },
        { code: "dup", w: "Zaten var", c: "warn", n: dups },
        { code: "nocari", w: "Cari yok", c: "red", n: noc },
      ];
      const stWord = (code) => code === "ready" ? { w: "İşlenecek", c: "ok" }
        : code === "dup" ? { w: "Zaten var", c: "warn" } : { w: "Cari yok", c: "red" };

      const visIdx = items.map((it, i) => i).filter((i) => !statusFilter || st[i].code === statusFilter);

      const rowsHtml = visIdx.map((i) => {
        const it = items[i], s = st[i], d = durumInfo(it), sw = stWord(s.code);
        const durumTxt = it.durum === "acik" ? "" : ` · ${d.label}`;
        const right = s.code === "nocari"
          ? `<div class="v">${fmtTRY(it.amount)}</div><div class="pv-acts">
               <button class="pv-add match" data-matchcari="${i}">🔗 Eşleştir / Ekle</button>
             </div>`
          : `<div class="v">${fmtTRY(it.amount)}</div><div class="st ${sw.c}">${sw.w}</div>`;
        return `<div class="pv-row" data-row="${i}" data-ask="${i}">
          <span class="dot ${sw.c}"></span>
          <div class="mid"><div class="nm">${esc(titleCase(it.ad || "-"))}</div>
            <div class="mt">${esc(shortNo(it.faturaNo))} · ${fmtDate(it.date)}${durumTxt}</div></div>
          <div class="amt">${right}</div>
        </div>`;
      }).join("");

      const segHtml = segs.map((g) => `
        <div class="s ${g.c} ${statusFilter === g.code ? "on" : ""}" data-seg="${g.code}">
          <div class="n">${g.n}</div><div class="l">${g.w}</div>
        </div>`).join("");

      // PC: defter tablosu görünümü (mobilde kartlar gizlenir) · Fatura No en sağda, tam
      const tableHtml = `<div class="pv-table"><table class="data">
        <thead><tr>
          <th></th><th>Cari Adı</th><th>Tarih</th><th>Durum</th>
          <th class="num">Borç</th><th class="num">Alacak</th><th></th><th class="pv-tfno">Fatura No</th>
        </tr></thead>
        <tbody>${visIdx.map((i) => {
          const it = items[i], s = st[i], sw = stWord(s.code), a = amountsOf(it);
          const durumTxt = it.durum === "acik" ? "" : ` · ${durumInfo(it).label}`;
          const act = s.code === "nocari"
            ? `<button class="pv-add match" data-matchcari="${i}">🔗 Eşleştir / Ekle</button>` : "";
          return `<tr data-row="${i}" data-ask="${i}">
            <td><span class="dot ${sw.c}"></span></td>
            <td class="pv-tnm">${esc(titleCase(it.ad || "-"))}</td>
            <td>${fmtDate(it.date)}</td>
            <td><span class="st ${sw.c}">${sw.w}</span>${durumTxt}</td>
            <td class="num">${a.borc ? fmtTRY(a.borc) : "—"}</td>
            <td class="num">${a.alacak ? fmtTRY(a.alacak) : "—"}</td>
            <td class="pv-tact">${act}</td>
            <td class="pv-tfno">${esc(it.faturaNo || "—")}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="8"><div class="empty" style="padding:16px">Bu süzgeçte fatura yok.</div></td></tr>`}</tbody>
      </table></div>`;

      editor.innerHTML = `
        <div class="card">
          <div class="pv-head">
            <div class="pv-title">${faturaTuru} Önizleme</div>
            <div class="pv-sub">${esc(main.name)} · ${items.length} fatura</div>
          </div>
          <div class="pv-seg">${segHtml}</div>
          <div class="pv-fhint">${statusFilter ? `Filtre: <b>${esc(stWord(statusFilter).w)}</b> · dokun kaldır` : "Bir başlığa dokunarak süzebilirsin"}</div>
          ${dupCaris.length ? `<div class="notice warn" style="margin:0 0 10px" id="merge-note">🔗 <b>${dupCaris.length}</b> olası tekrar cari bulundu (aynı cari iki kez açılmış olabilir). <a href="#" id="merge-cari">Birleştir</a></div>` : ""}
          <div class="pv-rows">${rowsHtml || `<div class="empty" style="padding:20px">Bu süzgeçte fatura yok.</div>`}</div>
          ${tableHtml}
          <div class="pv-cta">
            ${kind === "satis" ? `<button class="btn btn-sm" id="reask">Durumları Sor</button>` : ""}
            <div class="grow"></div>
            <button class="btn btn-primary" id="send-inv" ${processable ? "" : "disabled"}>📤 ${processable} Faturayı İşle${noc ? ` <small style="opacity:.85">(${noc} cari açılacak)</small>` : ""}</button>
          </div>
        </div>`;

      $$("[data-seg]", editor).forEach((el) => el.onclick = () => {
        statusFilter = statusFilter === el.dataset.seg ? null : el.dataset.seg;
        draw();
      });
      $$("[data-ask]", editor).forEach((el) => el.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        if (kind === "satis") askOne(+el.dataset.ask);   // alışta durum sorulmaz
      }));
      const reask = $("#reask", editor);
      if (reask) reask.onclick = () => runWizard(nonDupIdx());
      $$("[data-addcari]", editor).forEach((b) => b.onclick = () => createCari(items[+b.dataset.addcari]));
      $$("[data-matchcari]", editor).forEach((b) => b.onclick = () => matchCari(items[+b.dataset.matchcari]));
      const mc = $("#merge-cari", editor);
      if (mc) mc.onclick = (e) => { e.preventDefault(); openMergeModal(dupCaris); };
      const send = $("#send-inv", editor);
      if (send) send.onclick = () => onSend(send);
    }

    async function onSend(sendBtn) {
      sendBtn.disabled = true;
      // Önce eksik carileri (resmi ünvanla) otomatik aç
      const missing = items.filter((it) => statusOf(it).code === "nocari");
      if (missing.length) {
        const seen = new Set();
        for (const it of missing) {
          const key = it.vkn || nrm(it.ad);
          if (seen.has(key)) continue;
          seen.add(key);
          await createCari(it, true);
        }
        toast(`${seen.size} eksik cari açıldı.`, "ok");
      }
      const fresh = await fetchAll(C.accountEntries).catch(() => []);
      let gno = fresh.reduce((m, e) => Math.max(m, e.islemNo || 0), 0);
      const cnoMap = new Map();
      const docs = [];
      let sDup = 0, sNo = 0;
      for (const it of items) {
        const acc = findAcc(it);
        if (!acc) { sNo++; continue; }
        const exists = it.faturaNo && (
          fresh.some((e) => e.accountId === acc.id && String(e.faturaNo || "") === it.faturaNo) ||
          docs.some((d) => d.accountId === acc.id && d.faturaNo === it.faturaNo));
        if (exists) { sDup++; continue; }
        if (!cnoMap.has(acc.id))
          cnoMap.set(acc.id, fresh.filter((e) => e.accountId === acc.id).reduce((m, e) => Math.max(m, e.cariNo || 0), 0));
        const cno = cnoMap.get(acc.id) + 1; cnoMap.set(acc.id, cno);
        gno++;
        const a = amountsOf(it);
        docs.push({
          accountId: acc.id, accountCode: acc.code || "",
          islemNo: gno, cariNo: cno,
          date: it.date || todayISO(),
          sahis: it.ad || "", vkn: it.vkn || "",
          aciklama: "Fatura",
          borc: a.borc, alacak: a.alacak, durum: it.durum,
          faturaTuru, faturaNo: it.faturaNo || "",
          source: "fatura-import", createdAt: serverTimestamp(), createdBy: currentUser.email,
        });
      }
      if (!docs.length) { sendBtn.disabled = false; return toast(`İşlenecek yeni fatura yok (${sDup} zaten var, ${sNo} cari yok).`, "err"); }
      const impTok = "imp" + Date.now() + uid();
      docs.forEach((d) => d.impTok = impTok);   // incelemede sarı vurgu için
      try {
        await batchAdd(C.accountEntries, docs);
        await logAction("İçe Aktarma", "Cari Fatura", `${main.code} ${main.name} · ${docs.length} ${faturaTuru}`);
        const affected = [...new Set(docs.map((d) => d.accountId))];
        // ---- İşlem özeti bildirimi ----
        let sumHtml;
        if (kind === "satis") {
          const veresiye = docs.reduce((s, d) => s + Math.max(0, parseNum(d.borc) - parseNum(d.alacak)), 0);
          const tahsil = docs.reduce((s, d) => s + parseNum(d.alacak), 0);
          sumHtml = `<div class="inv-line"><span class="e">🧾</span> <b class="neg">${fmtTRY(veresiye)}</b> veresiye (açık — tahsil edilecek)</div>
            ${tahsil > 0.005 ? `<div class="inv-line"><span class="e">💵</span> <b class="pos">${fmtTRY(tahsil)}</b> tahsil edildi (kapalı)</div>` : ""}`;
        } else {
          const borclandin = docs.reduce((s, d) => s + Math.max(0, parseNum(d.alacak) - parseNum(d.borc)), 0);
          sumHtml = `<div class="inv-line"><span class="e">🧾</span> Bugün <b class="neg">${fmtTRY(borclandin)}</b> borçlandın</div>`;
        }
        // Önce tamamlama animasyonu, sonra özet
        successAnim(`${docs.length} fatura işlendi`, () => {
          const body = document.createElement("div");
          body.innerHTML = `<div class="inv-sum">${sumHtml}<div class="inv-note">${docs.length} ${faturaTuru} işlendi · ${affected.length} cari${sDup ? ` · ${sDup} zaten vardı` : ""}</div></div>`;
          const m = openModal({ title: "✅ İşlem Özeti", body, footer: [
            mkBtn("Kapat", "", () => m.close()),
            mkBtn("Carileri İncele →", "btn-primary", () => { m.close(); reviewQueue = { ids: affected, index: 0, tok: impTok }; location.hash = "#/hesap-detay?id=" + affected[0]; }),
          ]});
        });
      } catch (e) { toast("Hata: " + e.message, "err"); sendBtn.disabled = false; }
    }

    // Önce önizlemeyi çiz (satışta sihirbaz önizlemenin üstünde açılır, sıradaki kayıt renkle vurgulanır)
    draw();
    const startIdx = nonDupIdx();
    if (kind === "satis" && startIdx.length) runWizard(startIdx);
  }
}

// ===========================================================================
//  MODÜL: BANKA İŞLEME
// ===========================================================================
const BK_BANKS = [
  { key: "garanti", label: "Garanti",   emoji: "🟢", bankCode: "102.01", blokeCode: "108.01" },
  { key: "tfinans", label: "T. Finans", emoji: "🔵", bankCode: "102.02", blokeCode: "108.02" },
  { key: "ziraat",  label: "Ziraat",    emoji: "🟡", bankCode: "102.03", blokeCode: null },
];
// gg/aa/yyyy → Date · Date → ISO
function bkParseDate(s) {
  if (s instanceof Date && !isNaN(s)) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}
function bkISO(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
// Banka açıklamasından "imza": ref/numara öncesi metin (benzer açıklamaları eşlemek için)
function bkSig(desc) {
  let s = String(desc || "").toLocaleLowerCase("tr").trim();
  const cut = s.search(/\d{4,}/);
  if (cut > 2) s = s.slice(0, cut);
  s = s.replace(/[^a-zçğıöşü ]/gi, " ").replace(/\s+/g, " ").trim();
  return s.length >= 3 ? s : String(desc || "").toLocaleLowerCase("tr").replace(/\s+/g, " ").trim().slice(0, 18);
}
// Garanti POS satırını ayrıştır: PK.. KARTKODU AA/GG K: komisyon  → tip gün farkından
function bkClassifyGaranti(aoa) {
  const low = (x) => String(x).toLocaleLowerCase("tr");
  const hi = aoa.findIndex((r) => { const j = r.map(low); return j.includes("tarih") && j.some((x) => x.includes("açıklama")) && j.includes("tutar"); });
  if (hi < 0) throw new Error("Başlık satırı (Tarih/Açıklama/Tutar) bulunamadı.");
  const H = aoa[hi].map((x) => String(x).trim());
  const idx = (ks) => { for (const k of ks) { const i = H.findIndex((h) => low(h).includes(k)); if (i >= 0) return i; } return -1; };
  const ci = { tarih: idx(["tarih"]), acik: idx(["açıklama", "aciklama"]), etiket: idx(["etiket"]), tutar: idx(["tutar"]), dekont: idx(["dekont"]) };
  const rows = aoa.slice(hi + 1).filter((r) => bkParseDate(r[ci.tarih]));
  const pos = [], other = [];
  rows.forEach((r, seq) => {
    const dep = bkParseDate(r[ci.tarih]), desc = String(r[ci.acik] || ""), amt = parseNum(r[ci.tutar]), dekont = String(r[ci.dekont] || "");
    const m = desc.match(/^(PK\d+)\s+(\S+)\s+(\d{2})\/(\d{2})\s+K:\s*([\d.,]+)/);
    if (m) {
      let cek = new Date(dep.getFullYear(), +m[3] - 1, +m[4]);
      if (cek > dep) cek = new Date(dep.getFullYear() - 1, +m[3] - 1, +m[4]);
      const diff = Math.round((dep - cek) / 86400000);
      const tip = diff === 23 ? "KK" : diff === 16 ? "DK" : diff === 1 ? "YDK" : null;
      pos.push({ seq, dep: bkISO(dep), cek: bkISO(cek), diff, tip, kart: m[2], kom: parseNum(m[5]), amt, dekont, desc });
    } else {
      other.push({ seq, dep: bkISO(dep), etiket: String(r[ci.etiket] || ""), amt, dekont, desc });
    }
  });
  return { pos, other };
}
// POS satırlarını (yatış günü + çekim tarihi + tip) bazında grupla.
// Sıralama: yatış günü, sonra dosyadaki kayıt sırası (gün gün, karışmadan).
function bkGroupPos(pos) {
  const g = {};
  pos.forEach((p) => {
    if (!p.tip) return;
    const k = p.dep + "|" + p.cek + "|" + p.tip;
    if (!g[k]) g[k] = { dep: p.dep, cek: p.cek, tip: p.tip, net: 0, kom: 0, n: 0, ord: p.seq };
    else g[k].ord = Math.min(g[k].ord, p.seq);
    g[k].net += p.amt; g[k].kom += p.kom; g[k].n++;
  });
  return Object.values(g).sort((a, b) => a.dep.localeCompare(b.dep) || a.ord - b.ord);
}

// --- T. Finans yardımcıları -------------------------------------------------
// "05.08.2026 14:39" → { date:"2026-08-05", time:"14:39" }
function tfDateTime(s) {
  if (s instanceof Date && !isNaN(s))
    return { date: bkISO(new Date(s.getFullYear(), s.getMonth(), s.getDate())),
             time: String(s.getHours()).padStart(2, "0") + ":" + String(s.getMinutes()).padStart(2, "0") };
  const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, time: m[4] ? `${m[4]}:${m[5]}` : "" } : null;
}
function tfCardDate(s) {
  if (s instanceof Date && !isNaN(s)) return bkISO(new Date(s.getFullYear(), s.getMonth(), s.getDate()));
  const m = String(s).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
// Kart tutarı ABD biçimi: "20,589.86 TL" → 20589.86
function parseUSD(s) {
  if (typeof s === "number") return s;
  const v = parseFloat(String(s || "").replace(/tl/i, "").replace(/\s/g, "").replace(/,/g, ""));
  return isNaN(v) ? 0 : v;
}
// Hesap dosyası: Blokeye Alma (satış→bloke) + Bloke Çözüm (bloke→kart harcaması)
function tfParseHesap(aoa) {
  const low = (x) => String(x).toLocaleLowerCase("tr");
  const hi = aoa.findIndex((r) => { const j = r.map(low); return j.some((x) => x.includes("tarih")) && j.some((x) => x.includes("açıklama") || x.includes("aciklama")) && j.some((x) => x.includes("tutar")); });
  if (hi < 0) throw new Error("Hesap başlığı (Tarih/Açıklama/Tutar) bulunamadı.");
  const H = aoa[hi].map((x) => String(x).trim());
  const idx = (ks) => { for (const k of ks) { const i = H.findIndex((h) => low(h).includes(k)); if (i >= 0) return i; } return -1; };
  const ci = { tarih: idx(["işlem tarih", "tarih"]), ref: idx(["referans"]), acik: idx(["açıklama", "aciklama"]), tutar: idx(["tutar"]) };
  const alma = [], cozum = [], other = [];
  aoa.slice(hi + 1).forEach((r, seq) => {
    const dt = tfDateTime(r[ci.tarih]); if (!dt) return;
    const acik = String(r[ci.acik] || ""), amt = parseNum(r[ci.tutar]), ref = String(r[ci.ref] || "").trim();
    const la = acik.toLocaleLowerCase("tr");
    const rec = { seq, date: dt.date, time: dt.time, amt, ref, acik };
    if (la.includes("blokeye alma")) alma.push(rec);
    else if (la.includes("bloke çözüm") || la.includes("bloke cozum")) cozum.push(rec);
    else other.push(rec);
  });
  return { alma, cozum, other };
}
// Kart dosyası satırları: { date, merchant, amt }
function tfParseCard(aoa) {
  const low = (x) => String(x).toLocaleLowerCase("tr");
  const hi = aoa.findIndex((r) => { const j = r.map(low); return j.some((x) => x.includes("tarih")) && j.some((x) => x.includes("açıklama") || x.includes("aciklama")) && j.some((x) => x.includes("tutar")); });
  if (hi < 0) return [];
  const H = aoa[hi].map((x) => String(x).trim());
  const idx = (ks) => { for (const k of ks) { const i = H.findIndex((h) => low(h).includes(k)); if (i >= 0) return i; } return -1; };
  const ci = { tarih: idx(["işlem tarih", "tarih"]), acik: idx(["açıklama", "aciklama"]), tutar: idx(["işlem tutar", "tutar"]) };
  const out = [];
  aoa.slice(hi + 1).forEach((r) => {
    const date = tfCardDate(r[ci.tarih]), amt = parseUSD(r[ci.tutar]), merchant = String(r[ci.acik] || "").trim();
    if (!date || !amt || !merchant || /ek kart/i.test(merchant)) return;
    out.push({ date, merchant, amt });
  });
  return out;
}
// Çözümleri kart harcamalarıyla eşleştir (ters kayıt netleme + aynı gün/tutar)
function tfMatch(cozum, cards) {
  const near = (a, b) => Math.abs(a - b) < 0.01;
  const pos = cozum.filter((c) => c.amt > 0), neg = cozum.filter((c) => c.amt < 0);
  const canceled = new Set();
  pos.forEach((p) => {
    const n = neg.find((x) => !canceled.has(x.seq) && x.date === p.date && near(Math.abs(x.amt), p.amt));
    if (n) canceled.add(n.seq);
  });
  const expenses = neg.filter((n) => !canceled.has(n.seq));
  const used = new Set();
  const results = expenses.map((e) => {
    const a = Math.abs(e.amt);
    let ci = cards.findIndex((c, i) => !used.has(i) && c.date === e.date && near(c.amt, a));
    let approx = false;
    if (ci < 0) { ci = cards.findIndex((c, i) => !used.has(i) && near(c.amt, a)); if (ci >= 0) approx = true; }
    if (ci >= 0) { used.add(ci); return { ...e, amt: a, card: cards[ci], approx }; }
    return { ...e, amt: a, card: null, approx: false };
  });
  const cancelCount = canceled.size + pos.length;
  return { results, cancelCount };
}

async function viewBanka(c) {
  const allAcc = await fetchAll(C.accounts).catch(() => []);
  c.innerHTML = `<div id="bk-body"></div>`;
  let lastBloke = null;   // { title, html } — son önizlemedeki bloke kontrolü (inceleme sonrası gösterilir)
  chooseBank();

  // Aktarım sonrası: hesapları tek tek incele → bitince bloke kontrolü penceresi
  function showBloke(ctrl) {
    if (!ctrl || !ctrl.html) { location.hash = "#/hesaplar"; return; }
    const body = document.createElement("div");
    body.className = "bk-bloke-modal";
    body.innerHTML = ctrl.html;
    const m = openModal({ title: ctrl.title || "🧮 Bloke Kontrolü", body, footer: [
      mkBtn("Bitti ✓", "btn-primary", () => { m.close(); location.hash = "#/hesaplar"; }),
    ]});
  }
  function afterBankImport(affected, tok, ctrl) {
    if (affected && affected.length) {
      reviewQueue = { ids: affected, index: 0, tok, after: () => showBloke(ctrl) };
      location.hash = "#/hesap-detay?id=" + affected[0];
    } else {
      showBloke(ctrl);
    }
  }

  function chooseBank() {
    const body = $("#bk-body");
    body.innerHTML = `
      <div class="card">
        <div class="ft-q">Hangi bankanın hareketleri?<small>Dosyayı ona göre okuyacağım</small></div>
        <div class="bk-choose">
          ${BK_BANKS.map((b) => `<button class="bk-c" data-bank="${b.key}"><span class="ic">${b.emoji}</span><span class="t">${esc(b.label)}</span></button>`).join("")}
        </div>
      </div>`;
    $$(".bk-c", body).forEach((btn) => btn.onclick = () => {
      const bank = BK_BANKS.find((x) => x.key === btn.dataset.bank);
      if (bank.key === "garanti") renderGaranti(bank);
      else if (bank.key === "tfinans") renderTFinans(bank);
      else renderSoon(bank);
    });
  }

  function renderSoon(bank) {
    const body = $("#bk-body");
    body.innerHTML = `<div class="card">
      <div class="notice warn">⚠️ <b>${esc(bank.label)}</b> aktarımı yakında eklenecek. Şimdilik <b>Garanti</b> hazır.</div>
      <button class="btn" id="bk-back">← Banka seç</button></div>`;
    $("#bk-back", body).onclick = chooseBank;
  }

  function renderGaranti(bank) {
    const bankAcc = allAcc.find((a) => String(a.code) === bank.bankCode);
    const blokeAcc = allAcc.find((a) => String(a.code) === bank.blokeCode);
    const body = $("#bk-body");
    // Hesap planı eksikse önce uyar (dosya isteme)
    if (!bankAcc || !blokeAcc) {
      body.innerHTML = `<div class="card">
        <div class="card-head"><h3>🟢 Garanti</h3><button class="btn btn-sm" id="bk-back">← Banka</button></div>
        ${bankAcc ? "" : `<div class="notice warn">⚠️ <b>102.01 Garanti Banka</b> hesabı yok. <a href="#/hesaplar">Hesaplar</a>'dan varsayılan planı oluşturun.</div>`}
        ${blokeAcc ? "" : `<div class="notice warn">⚠️ <b>108.01 Garanti Bloke</b> hesabı yok.</div>`}</div>`;
      $("#bk-back", body).onclick = chooseBank;
      return;
    }
    // Seçince direkt dosya iste (üstte yükleme kutusu yok)
    pickGarantiFile(bank, bankAcc, blokeAcc);
  }

  function pickGarantiFile(bank, bankAcc, blokeAcc) {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".xlsx,.xls,.csv"; input.style.display = "none";
    document.body.appendChild(input);
    input.onchange = async () => {
      const file = input.files && input.files[0]; input.remove();
      if (!file) return;
      const lb = loadingBar("Dosya okunuyor…");
      try {
        const aoa = await parseSheetAOA(file);
        const { pos, other } = bkClassifyGaranti(aoa);
        if (!pos.length && !other.length) { lb.finish(); return toast("Hareket bulunamadı.", "err"); }
        lb.finish(() => {
          showGarantiEditor(bank, bankAcc, blokeAcc);
          buildGaranti(bank, bankAcc, blokeAcc, pos, other);
          toast(`${pos.length + other.length} hareket okundu.`, "ok");
        });
      } catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
    };
    input.click();
  }

  function showGarantiEditor(bank, bankAcc, blokeAcc) {
    const body = $("#bk-body");
    body.innerHTML = `
      <div class="ch-bar">
        <span class="ch-title">🟢 Garanti</span>
        <div class="grow"></div>
        <button class="btn btn-sm" id="bk-reup">📄 Başka Dosya</button>
        <button class="btn btn-sm" id="bk-back">← Banka</button>
      </div>
      <div id="bk-editor"></div>`;
    $("#bk-back", body).onclick = chooseBank;
    $("#bk-reup", body).onclick = () => pickGarantiFile(bank, bankAcc, blokeAcc);
  }

  async function buildGaranti(bank, bankAcc, blokeAcc, pos, other) {
    const editor = $("#bk-editor");
    const groups = bkGroupPos(pos);
    const belirsiz = pos.filter((p) => !p.tip);
    const [entries, settings] = await Promise.all([
      fetchAll(C.accountEntries).catch(() => []),
      fetchAll(C.settings).catch(() => []),
    ]);
    // Rapor önerileri: Gider Grupları kalemleri
    const eg = settings.find((s) => s.id === "expenseGroups");
    const egGroups = (eg && Array.isArray(eg.groups)) ? eg.groups : DEFAULT_EXPENSE_GROUPS;
    const raporItems = egGroups.flatMap((g) => (g.items || []).map((it) => ({ grup: g.name, ad: it })));

    // Eşleştirmeye açık (yaprak) hesaplar + geçmişten öğrenilen açıklama→hesap eşleşmeleri
    const parentIds = new Set(allAcc.map((a) => a.parentId).filter(Boolean));
    const leafAccs = allAcc.filter((a) => !parentIds.has(a.id) && a.code).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const accLabel = (a) => `${a.code} · ${a.name}`;
    const aliasMap = {};
    entries.filter((e) => e.source === "banka-diger" && e.bankaAciklama && e.matchedCode).forEach((e) => {
      const s = bkSig(e.bankaAciklama);
      const custom = (e.aciklama && e.aciklama !== "Gelen Eft" && e.aciklama !== "Giden Eft") ? e.aciklama : "";
      if (s) aliasMap[s] = { code: e.matchedCode, name: e.matchedName || "", rapor: e.rapor || "", acik: custom };
    });
    const resolveAcc = (val) => {
      const v = String(val || "").trim(); if (!v) return null;
      return leafAccs.find((a) => accLabel(a) === v)
        || leafAccs.find((a) => String(a.code) === v)
        || leafAccs.find((a) => normTr(a.name) === normTr(v))
        || (v.length >= 3 ? leafAccs.find((a) => normTr(a.name).startsWith(normTr(v))) : null) || null;
    };

    // Gün sonu blokesiyle eşleşme (kontrol)
    const tipMatch = (acik, tip) => String(acik || "").includes(" " + tip + " ");
    const blokeBorcOf = (g) => !blokeAcc ? 0 : entries
      .filter((e) => e.accountId === blokeAcc.id && e.source === "gunsonu-bloke" && e.date === g.cek && tipMatch(e.aciklama, g.tip))
      .reduce((s, e) => s + parseNum(e.borc), 0);

    const tipIco = (t) => t === "YDK" ? "🌍" : t === "DK" ? "💳" : "🏦";
    // Yatış günü bazında birleşik liste: her günde önce POS blokeleri, sonra POS dışı — hepsi banka kayıt sırasında
    const byDay = {};
    const day = (d) => byDay[d] || (byDay[d] = { pos: [], items: [] });
    groups.forEach((g) => { day(g.dep).pos.push(g); day(g.dep).items.push({ kind: "pos", ord: g.ord, g }); });
    other.forEach((o) => day(o.dep).items.push({ kind: "other", ord: o.seq, o }));
    const days = Object.keys(byDay).sort();

    // 102 bankanın mevcut bakiyesi (yürüyen bakiye buradan başlar)
    const bankBase = (bankAcc.openingBalance ?? bankAcc.balance ?? 0)
      + entries.filter((e) => e.accountId === bankAcc.id).reduce((s, e) => s + parseNum(e.giren) - parseNum(e.cikan), 0);
    const blokeLabel = blokeAcc ? `${blokeAcc.code} · ${blokeAcc.name}` : "108 Bloke";

    // Sıralı satır dizisi (yatış günü sırasına göre; ara başlık yok, yürüyen bakiye için POS/komisyon ayrı)
    const seq = [];
    days.forEach((d) => {
      const items = byDay[d].items.slice().sort((a, b) => a.ord - b.ord);
      items.forEach((it) => {
        if (it.kind === "pos") {
          const g = it.g;
          seq.push({ t: "pos", g, giren: g.net + g.kom, cikan: 0 });
          if (g.kom > 0.005) seq.push({ t: "kom", g, giren: 0, cikan: g.kom });
        } else {
          const o = it.o, inc = o.amt >= 0;
          seq.push({ t: "oth", o, giren: inc ? o.amt : 0, cikan: inc ? 0 : Math.abs(o.amt) });
        }
      });
    });

    const posRowHtml = (g, bal) => `<tr class="pv-r pv-pos">
        <td data-label="Tarih">${fmtDateShort(g.dep)}</td>
        <td data-label="İşlem Adı">${tipIco(g.tip)} Bloke Çözüm</td>
        <td data-label="İlgili Hesap" class="pv-muted">${esc(blokeLabel)}</td>
        <td data-label="Açıklama">${fmtDateShort(g.cek)} ${esc(g.tip)} Çözüldü <small>${g.n} hareket</small></td>
        <td data-label="Banka Açıklaması" class="pv-dash">—</td>
        <td data-label="Rapor" class="pv-dash">—</td>
        <td class="num pv-in" data-label="Giren Tutar">${fmtTRY(g.net + g.kom)}</td>
        <td class="num pv-dash" data-label="Çıkan Tutar">—</td>
        <td class="num pv-bal" data-label="Güncel Bakiye">${fmtTRY(bal)}</td>
      </tr>`;
    const komRowHtml = (g, bal) => `<tr class="pv-r pv-pos">
        <td data-label="Tarih">${fmtDateShort(g.dep)}</td>
        <td data-label="İşlem Adı">🧾 Komisyon</td>
        <td data-label="İlgili Hesap" class="pv-dash">—</td>
        <td data-label="Açıklama">${fmtDateShort(g.cek)} ${esc(g.tip)} Komisyonu</td>
        <td data-label="Banka Açıklaması" class="pv-dash">—</td>
        <td data-label="Rapor" class="pv-muted">POS Komisyonu</td>
        <td class="num pv-dash" data-label="Giren Tutar">—</td>
        <td class="num pv-out" data-label="Çıkan Tutar">${fmtTRY(g.kom)}</td>
        <td class="num pv-bal" data-label="Güncel Bakiye">${fmtTRY(bal)}</td>
      </tr>`;
    const othRowHtml = (o, bal) => {
      let sug = aliasMap[bkSig(o.desc)];
      if (!sug) {
        const s = normTr(bkSig(o.desc));
        const a = s && leafAccs.find((x) => normTr(x.name).length >= 4 && (s.startsWith(normTr(x.name)) || normTr(x.name).startsWith(s)));
        if (a) sug = { code: a.code, name: a.name, rapor: "", acik: "" };
      }
      const accVal = sug ? `${sug.code} · ${sug.name}` : "";
      const rapVal = sug ? sug.rapor : "";
      // Otomatik notu (tahsil edildi/ödendi) özel açıklama sanma; sadece gerçek özel not kalsın
      const acikVal = (sug && sug.acik && !/tahsil edildi|ödendi/i.test(sug.acik)) ? sug.acik : "";
      const inc = o.amt >= 0;
      const note = `Garanti ile ${inc ? "tahsil edildi" : "ödendi"}`;
      const rapCell = !inc
        ? `<td data-label="Rapor"><input class="bk-rapor pv-pick bk-pick" data-seq="${o.seq}" placeholder="🔎 Rapor seç" value="${esc(rapVal)}" readonly /></td>`
        : `<td data-label="Rapor" class="pv-dash">—</td>`;
      return `<tr class="pv-r pv-oth" data-seq="${o.seq}">
          <td data-label="Tarih">${fmtDateShort(o.dep)}</td>
          <td data-label="İşlem Adı">${inc ? "↘️" : "↗️"} Para Transferi</td>
          <td data-label="İlgili Hesap"><input class="bk-acc pv-pick bk-pick" data-seq="${o.seq}" placeholder="🔎 Hesap seç / ekle" value="${esc(accVal)}" readonly /></td>
          <td data-label="Açıklama"><button class="bk-note" type="button" data-seq="${o.seq}" data-def="${esc(note)}" title="Düzenlemek için tıkla"><span class="bk-note-txt">${esc(acikVal || note)}</span></button>
            <input class="bk-acik pv-acik-inline" data-seq="${o.seq}" placeholder="Özel açıklama…" value="${esc(acikVal)}" hidden /></td>
          <td data-label="Banka Açıklaması" class="pv-bank"><span class="pv-bank-txt">${esc(o.desc)}</span></td>
          ${rapCell}
          <td class="num ${inc ? "pv-in" : "pv-dash"}" data-label="Giren Tutar">${inc ? fmtTRY(o.amt) : "—"}</td>
          <td class="num ${!inc ? "pv-out" : "pv-dash"}" data-label="Çıkan Tutar">${!inc ? fmtTRY(Math.abs(o.amt)) : "—"}</td>
          <td class="num pv-bal" data-label="Güncel Bakiye">${fmtTRY(bal)}</td>
        </tr>`;
    };

    let run = bankBase;
    const bodyRows = seq.map((r) => {
      run += (r.giren - r.cikan);
      if (r.t === "pos") return posRowHtml(r.g, run);
      if (r.t === "kom") return komRowHtml(r.g, run);
      return othRowHtml(r.o, run);
    }).join("");

    const tableHtml = seq.length ? `<div class="pv-tbl-wrap"><table class="data pv-tbl">
      <thead><tr><th>Tarih</th><th>İşlem Adı</th><th>İlgili Hesap</th><th>Açıklama</th><th>Banka Açıklaması</th><th>Rapor</th><th class="num">Giren Tutar</th><th class="num">Çıkan Tutar</th><th class="num">Güncel Bakiye</th></tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>` : `<div class="empty" style="padding:16px">Hareket yok.</div>`;

    const ctrlHtml = `
      <div class="bk-ctrl head"><span>Grup</span><span class="num">Gün Sonu Bloke</span><span class="num">Çözülen (brüt)</span><span class="num">Fark</span></div>
      ${days.filter((d) => byDay[d].pos.length).map((d) => `
        <div class="bk-ctrl-day">📅 ${fmtDate(d)}</div>
        ${byDay[d].pos.map((g) => {
          const brut = g.net + g.kom, bb = blokeBorcOf(g), fark = bb - brut;
          const warn = Math.abs(fark) > 1;
          return `<div class="bk-ctrl ${warn ? "warn" : ""}">
            <span>${fmtDateShort(g.cek)} · ${esc(g.tip)}</span>
            <span class="num">${bb ? fmtNum(bb) : "—"}</span>
            <span class="num">${fmtNum(brut)}</span>
            <span class="num ${warn ? "bad" : "ok"}">${fmtNum(fark)}</span>
          </div>`;
        }).join("")}`).join("")}`;
    // İnceleme turu bitince gösterilecek bloke kontrolü
    lastBloke = groups.length ? { title: "🧮 Bloke Kontrolü", html: `<div class="bk-bloke-note">gün sonu ↔ çözülen · sarı satır = tutmuyor</div>${ctrlHtml}` } : null;

    const posNet = groups.reduce((s, g) => s + g.net, 0);
    const posKom = groups.reduce((s, g) => s + g.kom, 0);

    editor.innerHTML = `
      <div class="card">
        <div class="pv-head"><div class="pv-title">Banka Hareketleri</div>
          <div class="pv-sub">${groups.length} POS grubu · ${other.length} POS dışı · net ${fmtTRY(posNet)}${posKom ? ` · komisyon ${fmtTRY(posKom)}` : ""}</div></div>
        ${tableHtml}
        ${belirsiz.length ? `<div class="notice warn" style="margin:12px 0 0">⚠️ ${belirsiz.length} hareketin kart tipi belirsiz (gün farkı 23/16/1 değil). Bunlar işlenmez; bana ilet.</div>` : ""}
        ${other.length ? `<div class="pv-fhint" style="margin-top:10px">↘️/↗️ POS dışı satırlarda <b>Hesap</b> (ve çıkanlarda <b>Rapor</b>) zorunlu. Boş bırakılan işlenmez.</div>` : ""}
      </div>
      <div class="pv-cta">
        <div class="grow"></div>
        <button class="btn btn-primary" id="bk-save">✓ İşle</button>
      </div>`;

    const saveBtn = $("#bk-save", editor);
    // Hesap alanı → uygulama-içi aranabilir seçici
    $$(".bk-acc", editor).forEach((inp) => inp.onclick = () => openAccountPicker({
      accounts: leafAccs, title: "Hesap Seç", query: /·/.test(inp.value) ? "" : inp.value,
      onPick: (res) => { inp.value = res.acc ? accLabel(res.acc) : res.newName; inp.dispatchEvent(new Event("input", { bubbles: true })); },
    }));
    // Rapor alanı → hesap seçici ile aynı pencere
    $$(".bk-rapor", editor).forEach((inp) => inp.onclick = () => openRaporPicker({
      raporItems, query: inp.value,
      onPick: (val) => { inp.value = val; inp.dispatchEvent(new Event("input", { bubbles: true })); },
    }));
    // Açıklama metnine tıkla → özel açıklama düzenleme alanını aç/kapat; yazınca metni güncelle
    $$(".bk-note", editor).forEach((b) => {
      const seq = b.dataset.seq, inp = $(`.bk-acik[data-seq="${seq}"]`, editor);
      const txt = $(".bk-note-txt", b);
      if (!inp) return;
      b.onclick = () => { const show = inp.hidden; inp.hidden = !show; if (show) inp.focus(); };
      inp.addEventListener("input", () => { txt.textContent = inp.value.trim() || b.dataset.def || ""; });
    });
    // Banka Açıklaması → tek satır; tıklayınca genişler
    $$(".pv-bank", editor).forEach((td) => td.onclick = () => td.classList.toggle("expanded"));
    // Canlı doğrulama: hesap (+ çıkanlarda rapor) dolmadan İşle pasif (dolanlar normal görünür)
    function bkSync() {
      let missing = 0;
      $$(".pv-oth", editor).forEach((row) => {
        const acc = $(".bk-acc", row), rap = $(".bk-rapor", row);
        const ae = !acc.value.trim();
        acc.classList.toggle("bk-req", ae);
        if (ae) missing++;
        if (rap) {
          const re = !rap.value.trim();
          rap.classList.toggle("bk-req", re);
          if (re) missing++;
        }
      });
      const nothing = !groups.length && !other.length;
      if (!bankAcc || !blokeAcc || nothing) { saveBtn.disabled = true; saveBtn.textContent = "İşlenecek yok"; }
      else if (missing > 0) { saveBtn.disabled = true; saveBtn.textContent = `${missing} alan eksik`; }
      else { saveBtn.disabled = false; saveBtn.textContent = `✓ İşle (${groups.length + other.length})`; }
    }
    editor.addEventListener("input", bkSync);
    bkSync();
    saveBtn.onclick = () => saveAll(saveBtn, bank, bankAcc, blokeAcc, groups, other, resolveAcc, accLabel);
  }

  // ---- T. FİNANS: hesap (bloke) + kart dosyaları eşleştirme ----
  function renderTFinans(bank) {
    const blokeAcc = allAcc.find((a) => String(a.code) === bank.blokeCode); // 108.02
    const bankAcc = allAcc.find((a) => String(a.code) === bank.bankCode);   // 102.02
    const body = $("#bk-body");
    if (!blokeAcc || !bankAcc) {
      body.innerHTML = `<div class="card">
        <div class="card-head"><h3>🔵 T. Finans</h3><button class="btn btn-sm" id="bk-back">← Banka</button></div>
        ${blokeAcc ? "" : `<div class="notice warn">⚠️ <b>108.02 T.Finans Bloke</b> hesabı yok. <a href="#/hesaplar">Hesaplar</a>'dan varsayılan planı oluşturun.</div>`}
        ${bankAcc ? "" : `<div class="notice warn">⚠️ <b>102.02 T.Finans Banka</b> hesabı yok.</div>`}</div>`;
      $("#bk-back", body).onclick = chooseBank;
      return;
    }
    const st = { hesap: null, cards: [], cardFiles: [] };

    // Ortak dosya seçici (üstte yükleme kutusu yok)
    function pickTF(onAoa) {
      const input = document.createElement("input");
      input.type = "file"; input.accept = ".xlsx,.xls,.csv"; input.style.display = "none";
      document.body.appendChild(input);
      input.onchange = async () => {
        const file = input.files && input.files[0]; input.remove();
        if (!file) return;
        const lb = loadingBar("Dosya okunuyor…");
        try { const aoa = await parseSheetAOA(file); lb.finish(() => onAoa(aoa, file)); }
        catch (e) { lb.finish(); toast("Okunamadı: " + e.message, "err"); }
      };
      input.click();
    }
    function loadHesap() {
      pickTF((aoa) => {
        try {
          st.hesap = tfParseHesap(aoa);
          showTFBar(); rebuild();
          toast(`Hesap: ${st.hesap.alma.length} alma · ${st.hesap.cozum.length} çözüm`, "ok");
        } catch (e) { toast("Okunamadı: " + e.message, "err"); }
      });
    }
    function loadCard() {
      pickTF((aoa, file) => {
        const rows = tfParseCard(aoa);
        if (!rows.length) return toast("Kart hareketi bulunamadı.", "err");
        st.cards.push(...rows); st.cardFiles.push({ name: file.name, n: rows.length });
        showTFBar(); rebuild();
        toast(`${rows.length} kart hareketi eklendi.`, "ok");
      });
    }
    function showTFBar() {
      const b = $("#bk-body");
      if (!$(".ch-bar", b)) {
        b.innerHTML = `
          <div class="ch-bar">
            <span class="ch-title">🔵 T. Finans</span>
            <span class="ch-info" id="tf-bar-info"></span>
            <div class="grow"></div>
            <button class="btn btn-sm" id="tf-add-card">📄 Kart Dosyası</button>
            <button class="btn btn-sm" id="tf-reup">🔄 Hesap Dosyası</button>
            <button class="btn btn-sm" id="bk-back">← Banka</button>
          </div>
          <div id="tf-editor"></div>`;
        $("#bk-back", b).onclick = chooseBank;
        $("#tf-reup", b).onclick = () => { st.hesap = null; st.cards = []; st.cardFiles = []; loadHesap(); };
        $("#tf-add-card", b).onclick = loadCard;
      }
      const info = $("#tf-bar-info", b);
      if (info) {
        const parts = [];
        if (st.hesap) parts.push(`${st.hesap.alma.length} alma · ${st.hesap.cozum.length} çözüm`);
        if (st.cards.length) parts.push(`${st.cards.length} kart`);
        info.textContent = parts.join(" · ");
      }
    }
    function rebuild() { if (st.hesap) buildTFinans(bank, blokeAcc, bankAcc, st); }

    loadHesap();   // seçince direkt hesap dosyası iste
  }

  async function buildTFinans(bank, blokeAcc, bankAcc, st) {
    const editor = $("#tf-editor");
    const entries = await fetchAll(C.accountEntries).catch(() => []);
    const settings = await fetchAll(C.settings).catch(() => []);
    const eg = settings.find((s) => s.id === "expenseGroups");
    const egGroups = (eg && Array.isArray(eg.groups)) ? eg.groups : DEFAULT_EXPENSE_GROUPS;
    const raporItems = egGroups.flatMap((g) => (g.items || []).map((it) => ({ grup: g.name, ad: it })));

    // Eşleştirilebilir (yaprak) hesaplar + geçmişten öğrenilen açıklama→hesap
    const parentIds = new Set(allAcc.map((a) => a.parentId).filter(Boolean));
    const leafAccs = allAcc.filter((a) => !parentIds.has(a.id) && a.code).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    const accLabel = (a) => `${a.code} · ${a.name}`;
    const resolveAcc = (val) => {
      const v = String(val || "").trim(); if (!v) return null;
      return leafAccs.find((a) => accLabel(a) === v)
        || leafAccs.find((a) => String(a.code) === v)
        || leafAccs.find((a) => normTr(a.name) === normTr(v))
        || (v.length >= 3 ? leafAccs.find((a) => normTr(a.name).startsWith(normTr(v))) : null) || null;
    };
    // Mağaza/açıklama → {hesap, rapor} hafızası (geçmiş banka-diger + TF çözümlerinden)
    const aliasMap = {};
    entries.filter((e) => e.source === "banka-diger" && e.bankaAciklama && e.matchedCode)
      .forEach((e) => { aliasMap[bkSig(e.bankaAciklama)] = { code: e.matchedCode, name: e.matchedName || "", rapor: e.rapor || "" }; });
    const suggest = (merchant) => {
      if (!merchant) return null;
      const a = aliasMap[bkSig(merchant)];
      if (a) return a;
      const hit = resolveAcc(merchant);
      return hit ? { code: hit.code, name: hit.name, rapor: "" } : null;
    };

    const { results, cancelCount } = tfMatch(st.hesap.cozum, st.cards);
    const matched = results.filter((r) => r.card);
    const unmatched = results.filter((r) => !r.card);

    // Blokeye Alma: yatış günü bazında topla + gün sonu 108 borç ile kontrol (dosya sırası için seq izlenir)
    const almaByDay = {};
    st.hesap.alma.forEach((a) => { const g = (almaByDay[a.date] = almaByDay[a.date] || { sum: 0, n: 0, seq: a.seq }); g.sum += a.amt; g.n++; g.seq = Math.min(g.seq, a.seq); });
    const prevISO = (iso) => { const [y, m, d] = iso.split("-").map(Number); const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() - 1); return bkISO(dt); };
    const gsBorcByDay = {};
    entries.filter((e) => e.source === "gunsonu-bloke" && blokeAcc && e.accountId === blokeAcc.id)
      .forEach((e) => { gsBorcByDay[e.date] = (gsBorcByDay[e.date] || 0) + parseNum(e.borc); });
    const almaRows = Object.keys(almaByDay).sort().map((d) => {
      const gsDate = prevISO(d), gsBorc = gsBorcByDay[gsDate] || 0, sum = almaByDay[d].sum, fark = gsBorc - sum;
      return { almaDate: d, gsDate, sum, n: almaByDay[d].n, gsBorc, fark, ok: Math.abs(fark) < 1, seq: almaByDay[d].seq };
    });

    const cardOpts = st.cards.map((c, i) => ({ i, label: `${fmtDateShort(c.date)} · ${c.merchant} · ${fmtNum(c.amt)}` }));

    // 102.02 T.Finans Banka mevcut bakiyesi (yürüyen bakiye buradan başlar)
    const bankBase = (bankAcc.openingBalance ?? bankAcc.balance ?? 0)
      + entries.filter((e) => e.accountId === bankAcc.id).reduce((s, e) => s + parseNum(e.giren) - parseNum(e.cikan), 0);
    const blokeLabel = blokeAcc ? `${blokeAcc.code} · ${blokeAcc.name}` : "108 Bloke";

    // Blokeye alma → banka (giren, otomatik)
    const almaRowHtml = (a, bal) => `<tr class="pv-r pv-pos">
        <td data-label="Tarih">${fmtDateShort(a.almaDate)}</td>
        <td data-label="İşlem Adı">🏦 Bloke Çözüm</td>
        <td data-label="İlgili Hesap" class="pv-muted">${esc(blokeLabel)}</td>
        <td data-label="Açıklama">${fmtDateShort(a.almaDate)} Çekim Çözüldü <small>${a.n} hareket</small></td>
        <td data-label="Banka Açıklaması" class="pv-dash">—</td>
        <td data-label="Rapor" class="pv-dash">—</td>
        <td class="num pv-in" data-label="Giren Tutar">${fmtTRY(a.sum)}</td>
        <td class="num pv-dash" data-label="Çıkan Tutar">—</td>
        <td class="num pv-bal" data-label="Güncel Bakiye">${fmtTRY(bal)}</td>
      </tr>`;
    // Kart harcaması → banka çıkışı (İlgili Hesap = kime ödendi, Banka Açıklaması = mağaza)
    const cozumRowHtml = (r, i, kind, bal) => {
      const merc = r.card ? r.card.merchant : "";
      const sug = merc ? suggest(merc) : null;
      const accVal = sug ? `${sug.code} · ${sug.name}` : (merc ? titleCase(merc) : "");
      const rapVal = sug ? sug.rapor : "";
      const pickRow = kind === "unmatch"
        ? `<tr class="tf-cardpick-row" data-i="${i}"><td colspan="9">
             <select class="tf-card-pick f" data-i="${i}"><option value="">— kart harcaması seç (ops.) —</option>${cardOpts.map((o) => `<option value="${o.i}">${esc(o.label)}</option>`).join("")}</select>
           </td></tr>`
        : "";
      return `<tr class="pv-r tf-cz ${kind}" data-i="${i}" data-kind="${kind}">
          <td data-label="Tarih">${fmtDateShort(r.date)}${r.approx ? " <small>~</small>" : ""}</td>
          <td data-label="İşlem Adı">${kind === "match" ? (r.approx ? "🟡" : "🔓") : "❓"} Kart Harcaması</td>
          <td data-label="İlgili Hesap"><input class="tf-acc pv-pick tf-pick" data-i="${i}" placeholder="🔎 Hesap * seç / ekle" value="${esc(accVal)}" readonly /></td>
          <td data-label="Açıklama">T. Finans ile ödendi</td>
          <td data-label="Banka Açıklaması" class="pv-bank"><span class="nm pv-bank-txt">${merc ? esc(merc) : "Eşleşmedi — kart seç"}</span>${r.ref ? ` <small>${esc(r.ref)}</small>` : ""}</td>
          <td data-label="Rapor"><input class="tf-rapor pv-pick tf-pick" data-i="${i}" placeholder="🔎 Rapor *" value="${esc(rapVal)}" readonly /></td>
          <td class="num pv-dash" data-label="Giren Tutar">—</td>
          <td class="num pv-out" data-label="Çıkan Tutar">${fmtTRY(r.amt)}</td>
          <td class="num pv-bal" data-label="Güncel Bakiye">${fmtTRY(bal)}</td>
        </tr>${pickRow}`;
    };

    const almaBad = almaRows.filter((a) => !a.ok).length;
    // İnceleme turu bitince gösterilecek blokeye alma kontrolü (önizlemede gösterilmez)
    lastBloke = almaRows.length ? { title: "🧮 Blokeye Alma Kontrolü", html: `<div class="bk-bloke-note">gün sonu 108 ↔ blokeye alma · sarı = tutmuyor${almaBad ? ` · ${almaBad} gün tutmuyor` : " · hepsi tutuyor"}</div>
      <div class="bk-ctrl head"><span>Yatış günü</span><span class="num">Gün Sonu 108</span><span class="num">Blokeye Alma</span><span class="num">Fark</span></div>
      ${almaRows.map((a) => `<div class="bk-ctrl ${a.ok ? "" : "warn"}">
        <span>${fmtDateShort(a.almaDate)}<small> gs ${fmtDateShort(a.gsDate)}</small></span>
        <span class="num">${a.gsBorc ? fmtNum(a.gsBorc) : "—"}</span>
        <span class="num">${fmtNum(a.sum)}</span>
        <span class="num ${a.ok ? "ok" : "bad"}">${fmtNum(a.fark)}</span>
      </div>`).join("")}` } : null;

    const totMatch = matched.reduce((s, r) => s + r.amt, 0);
    const totUn = unmatched.reduce((s, r) => s + r.amt, 0);

    // Tek düz liste (ara başlık yok) — dosya sırası ters çevrilmiş (yüksek seq üstte)
    const tfSeq = [
      ...almaRows.map((a) => ({ kind: "alma", seq: a.seq, a, giren: a.sum, cikan: 0 })),
      ...results.map((r) => ({ kind: "coz", seq: r.seq, r, giren: 0, cikan: r.amt })),
    ].sort((x, y) => y.seq - x.seq);

    let run = bankBase;
    const tfBody = tfSeq.map((row) => {
      run += (row.giren - row.cikan);
      if (row.kind === "alma") return almaRowHtml(row.a, run);
      return cozumRowHtml(row.r, results.indexOf(row.r), row.r.card ? "match" : "unmatch", run);
    }).join("");

    const rowsHtml = tfSeq.length ? `<div class="pv-tbl-wrap"><table class="data pv-tbl">
      <thead><tr><th>Tarih</th><th>İşlem Adı</th><th>İlgili Hesap</th><th>Açıklama</th><th>Banka Açıklaması</th><th>Rapor</th><th class="num">Giren Tutar</th><th class="num">Çıkan Tutar</th><th class="num">Güncel Bakiye</th></tr></thead>
      <tbody>${tfBody}</tbody>
    </table></div>` : `<div class="empty" style="padding:16px">Bloke çözümü yok.</div>`;

    editor.innerHTML = `
      <div class="card">
        <div class="pv-head"><div class="pv-title">Bloke Çözümleri → Kart Harcamaları</div>
          <div class="pv-sub">${matched.length} eşleşti (${fmtTRY(totMatch)})${unmatched.length ? ` · ${unmatched.length} eşleşmedi (${fmtTRY(totUn)})` : ""}${cancelCount ? ` · ${cancelCount} ters kayıt netlendi` : ""}</div></div>
        ${rowsHtml}
        <div class="pv-fhint" style="margin-top:10px">Her harcamada <b>Hesap</b> (kime ödendi — 320/120…) ve <b>Rapor</b> zorunlu. Ödeme <b>102.02 T.Finans Banka</b>'dan çıkar ve seçilen hesabı kapatır. Gider Durum Raporu'na düşer.</div>
      </div>
      ${st.hesap.other.length ? `<div class="card"><div class="notice warn">ℹ️ ${st.hesap.other.length} satır bloke alma/çözüm değil (EFT vb.) — bu ekranda işlenmiyor.</div></div>` : ""}
      <div class="pv-cta"><div class="grow"></div><button class="btn btn-primary" id="tf-save">✓ İşle</button></div>`;

    // Hesap alanı → uygulama-içi aranabilir seçici
    $$(".tf-acc", editor).forEach((inp) => inp.onclick = () => openAccountPicker({
      accounts: leafAccs, title: "Hesap Seç", query: /·/.test(inp.value) ? "" : inp.value,
      onPick: (res) => { inp.value = res.acc ? `${res.acc.code} · ${res.acc.name}` : res.newName; inp.dispatchEvent(new Event("input", { bubbles: true })); },
    }));
    // Rapor alanı → hesap seçici ile aynı pencere
    $$(".tf-rapor", editor).forEach((inp) => inp.onclick = () => openRaporPicker({
      raporItems, query: inp.value,
      onPick: (val) => { inp.value = val; inp.dispatchEvent(new Event("input", { bubbles: true })); },
    }));
    // Banka Açıklaması → tek satır; tıklayınca genişler
    $$(".pv-bank", editor).forEach((td) => td.onclick = () => td.classList.toggle("expanded"));
    // Eşleşmeyen kart seçimi → mağaza adını + hesap/rapor önerisini satıra yaz
    $$(".tf-card-pick", editor).forEach((sel) => sel.onchange = () => {
      const row = $(`.tf-cz[data-i="${sel.dataset.i}"]`, editor), nm = $(".nm", row), acc = $(".tf-acc", row), rap = $(".tf-rapor", row);
      const ci = sel.value === "" ? -1 : +sel.value;
      if (ci >= 0) {
        const m = st.cards[ci].merchant; nm.textContent = m;
        const sug = suggest(m);
        if (!acc.value.trim()) acc.value = sug ? `${sug.code} · ${sug.name}` : titleCase(m);
        if (!rap.value.trim() && sug) rap.value = sug.rapor || "";
      } else nm.textContent = "Eşleşmedi — kart seç";
      tfSync();
    });

    const saveBtn = $("#tf-save", editor);
    function tfSync() {
      let missing = 0;
      $$(".tf-cz", editor).forEach((row) => {
        const acc = $(".tf-acc", row), rap = $(".tf-rapor", row);
        const ae = !acc.value.trim(); acc.classList.toggle("bk-req", ae); if (ae) missing++;
        const re = !rap.value.trim(); rap.classList.toggle("bk-req", re); if (re) missing++;
      });
      const nothing = !results.length && !almaRows.length;
      if (!blokeAcc || !bankAcc || nothing) { saveBtn.disabled = true; saveBtn.textContent = "İşlenecek yok"; }
      else if (missing > 0) { saveBtn.disabled = true; saveBtn.textContent = `${missing} alan eksik`; }
      else { saveBtn.disabled = false; saveBtn.textContent = `✓ İşle (${matched.length + unmatched.length} harcama · ${almaRows.length} blokeye alma)`; }
    }
    editor.addEventListener("input", tfSync);
    tfSync();

    saveBtn.onclick = () => tfSave(saveBtn, bank, blokeAcc, bankAcc, results, almaRows, st, editor, resolveAcc);
  }

  async function tfSave(btn, bank, blokeAcc, bankAcc, results, almaRows, st, editor, resolveAcc) {
    // Her harcama: Hesap + Rapor zorunlu; hesabı çöz
    const rows = results.map((r) => {
      const i = results.indexOf(r);
      const accVal = ($(`.tf-acc[data-i="${i}"]`, editor)?.value || "").trim();
      const rapor = ($(`.tf-rapor[data-i="${i}"]`, editor)?.value || "").trim();
      let merchant = r.card ? r.card.merchant : "";
      const pick = $(`.tf-card-pick[data-i="${i}"]`, editor);
      if (pick && pick.value !== "") merchant = st.cards[+pick.value].merchant;
      return { ...r, accVal, rapor, merchant, acc: resolveAcc(accVal) };
    });
    if (rows.some((r) => !r.accVal)) return toast("Tüm harcamalarda Hesap zorunlu.", "err");
    if (rows.some((r) => !r.rapor)) return toast("Tüm harcamalarda Rapor zorunlu.", "err");

    const toCreate = rows.filter((r) => !r.acc);
    if (toCreate.length) {
      const body = document.createElement("div");
      body.innerHTML = `<div class="mg-note">Şu isimler mevcut hesaplarla eşleşmedi. <b>Yeni hesap</b> olarak eklensin mi?</div>` +
        toCreate.map((r, i) => `<div class="bk-new">
          <div class="bk-new-nm">${esc(titleCase(r.accVal))}</div>
          <select class="bk-new-type" data-i="${i}">
            <option value="tedarikci" selected>Tedarikçi (320)</option>
            <option value="musteri">Müşteri (120)</option>
          </select>
        </div>`).join("");
      const m = openModal({ title: "Yeni Hesaplar", body, footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Ekle ve İşle", "btn-primary", async () => {
          const types = toCreate.map((r, i) => $(`.bk-new-type[data-i="${i}"]`, body)?.value || "tedarikci");
          m.close(); btn.disabled = true;
          try {
            for (let i = 0; i < toCreate.length; i++) toCreate[i].acc = await createBankCari(toCreate[i].accVal, types[i]);
            await tfDoSave(btn, bank, blokeAcc, bankAcc, rows, almaRows, editor);
          } catch (e) { toast("Hata: " + e.message, "err"); btn.disabled = false; }
        }),
      ]});
      return;
    }
    btn.disabled = true;
    await tfDoSave(btn, bank, blokeAcc, bankAcc, rows, almaRows, editor);
  }

  async function tfDoSave(btn, bank, blokeAcc, bankAcc, rows, almaRows, editor) {
    try {
      const fresh = await fetchAll(C.accountEntries).catch(() => []);
      const cozKeys = new Set(rows.map((r) => `${bank.key}|coz|${r.ref || r.date + "|" + r.seq}`));
      const almaKeys = new Set(almaRows.map((a) => `${bank.key}|alma|${a.almaDate}`));
      const isStale = (e) =>
        (e.source === "banka-diger" && e.banka === bank.key && cozKeys.has(e.otherKey)) ||
        (e.source === "banka-tf-cozum" && cozKeys.has(e.cozumKey)) ||
        (e.source === "banka-tf-alma" && almaKeys.has(e.almaKey));
      for (const e of fresh.filter(isStale)) await deleteDoc(doc(db, "accountEntries", e.id));
      const remaining = fresh.filter((e) => !isStale(e));
      let gno = remaining.reduce((m, e) => Math.max(m, e.islemNo || 0), 0);
      const cnoMap = new Map();
      const nextCno = (id) => {
        if (!cnoMap.has(id)) cnoMap.set(id, remaining.filter((e) => e.accountId === id).reduce((m, e) => Math.max(m, e.cariNo || 0), 0));
        const n = cnoMap.get(id) + 1; cnoMap.set(id, n); return n;
      };
      const docs = [];
      // Blokeye Alma → 108 blokeyi kapat (alacak) + 102'ye giriş ("Çekim Çözüldü")
      for (const a of almaRows) {
        const almaKey = `${bank.key}|alma|${a.almaDate}`;
        const acik = `${fmtDateShort(a.almaDate)} Çekim Çözüldü`;
        const common = { date: a.almaDate, source: "banka-tf-alma", almaKey, banka: bank.key, createdAt: serverTimestamp(), createdBy: currentUser.email };
        docs.push({ ...common, accountId: blokeAcc.id, accountCode: blokeAcc.code, islemNo: ++gno, cariNo: nextCno(blokeAcc.id),
          islemAdi: "BLOKE ÇÖZÜM", sahis: "", aciklama: acik, rapor: "", borc: 0, alacak: a.sum });
        docs.push({ ...common, accountId: bankAcc.id, accountCode: bankAcc.code, islemNo: ++gno,
          islemAdi: "BLOKE ÇÖZÜM", sahis: "", aciklama: acik, rapor: "", giren: a.sum, cikan: 0 });
      }
      // Kart harcaması → 102'den çıkış + seçilen hesabı kapat (karşı kayıt)
      for (const r of rows) {
        const acc = r.acc, ok = `${bank.key}|coz|${r.ref || r.date + "|" + r.seq}`;
        const common = { date: r.date, rapor: r.rapor, source: "banka-diger",
          otherKey: ok, banka: bank.key, bankaAciklama: r.merchant || "", matchedCode: acc.code, matchedName: acc.name, ref: r.ref || "",
          createdAt: serverTimestamp(), createdBy: currentUser.email };
        // 1) Banka çıkışı (102): açıklama = mağaza
        docs.push({ ...common, accountId: bankAcc.id, accountCode: bankAcc.code, islemNo: ++gno,
          islemAdi: "KART HARCAMASI", sahis: acc.name, aciklama: r.merchant || acc.name, giren: 0, cikan: r.amt });
        // 2) Seçilen hesap kapaması: üstte cari adı, açıklama = neyle ödendiği
        const cariStyle = isCari(acc.type) || String(acc.code || "").startsWith("108");
        const side = cariStyle ? { borc: r.amt, alacak: 0 } : { giren: 0, cikan: r.amt };
        docs.push({ ...common, accountId: acc.id, accountCode: acc.code, islemNo: ++gno,
          ...(cariStyle ? { cariNo: nextCno(acc.id) } : {}), islemAdi: "KART HARCAMASI", sahis: acc.name, aciklama: `${bank.label} ile ödendi`, ...side });
      }
      const impTok = "imp" + Date.now() + uid();
      docs.forEach((d) => d.impTok = impTok);
      await batchAdd(C.accountEntries, docs);
      await logAction("İçe Aktarma", "Banka", `${bank.label} · ${almaRows.length} blokeye alma + ${rows.length} harcama · ${docs.length} kayıt`);
      toast(`${rows.length} harcama + ${almaRows.length} blokeye alma işlendi.`, "ok");
      // İncelenecek hesaplar: harcamanın kapattığı cari/gider hesapları
      const affected = [...new Set(rows.map((r) => r.acc.id))];
      editor.innerHTML = `<div class="notice info">✔ İşlendi: <b>${almaRows.length}</b> blokeye alma (108→102), <b>${rows.length}</b> kart harcaması (102 çıkış + hesap kapama). İnceleme başlıyor…</div>`;
      successAnim(`${rows.length + almaRows.length} kayıt işlendi`, () => afterBankImport(affected, impTok, lastBloke));
    } catch (e) { toast("Hata: " + e.message, "err"); btn.disabled = false; }
  }

  // Eşleşmeyen isim için yeni cari aç (120 müşteri / 320 tedarikçi)
  async function createBankCari(name, type) {
    const main = allAcc.find((a) => a.type === type && !a.parentId) || allAcc.find((a) => a.type === type);
    if (!main) throw new Error((type === "tedarikci" ? "320 Tedarikçiler" : "120 Alıcılar") + " ana hesabı yok.");
    const siblings = allAcc.filter((a) => a.parentId === main.id);
    const code = nextSubCode(main, siblings);
    const payload = { code, name: titleCase(name), type: main.type, parentId: main.id, parentCode: main.code, vkn: "", openingBalance: 0, createdAt: serverTimestamp() };
    const ref = await addDoc(C.accounts(), payload);
    const acc = { id: ref.id, ...payload };
    allAcc.push(acc);
    await logAction("Ekleme", "Cari Hesap", `${code} ${payload.name}`);
    return acc;
  }

  async function saveAll(btn, bank, bankAcc, blokeAcc, groups, other, resolveAcc) {
    const editor = $("#bk-editor");
    // POS dışı satırlar: Şahıs zorunlu, çıkanlarda Rapor zorunlu
    const rows = [];
    for (const o of other) {
      const inp = $(`.bk-acc[data-seq="${o.seq}"]`, editor);
      const val = inp ? inp.value.trim() : "";
      if (!val) { inp?.focus(); return toast("Tüm hareketlerde Şahıs / Hesap zorunlu.", "err"); }
      const rapor = o.amt < 0 ? ($(`.bk-rapor[data-seq="${o.seq}"]`, editor)?.value || "").trim() : "";
      if (o.amt < 0 && !rapor) {
        $(`.bk-rapor[data-seq="${o.seq}"]`, editor)?.focus();
        return toast("Çıkan hareketlerde Rapor zorunlu.", "err");
      }
      rows.push({
        o, val, acc: resolveAcc(val), rapor,
        acik: ($(`.bk-acik[data-seq="${o.seq}"]`, editor)?.value || "").trim(),
      });
    }
    const ok = rows.filter((r) => r.acc);
    const toCreate = rows.filter((r) => !r.acc);
    if (!groups.length && !rows.length) return toast("İşlenecek kayıt yok.", "err");

    // Eşleşmeyen isimler varsa: yeni hesap onayı
    if (toCreate.length) {
      const body = document.createElement("div");
      body.innerHTML = `<div class="mg-note">Şu isimler mevcut hesaplarla eşleşmedi. <b>Yeni hesap</b> olarak eklensin mi?</div>` +
        toCreate.map((r, i) => `<div class="bk-new">
          <div class="bk-new-nm">${esc(titleCase(r.val))}</div>
          <select class="bk-new-type" data-i="${i}">
            <option value="musteri" ${r.o.amt >= 0 ? "selected" : ""}>Müşteri (120)</option>
            <option value="tedarikci" ${r.o.amt < 0 ? "selected" : ""}>Tedarikçi (320)</option>
          </select>
        </div>`).join("");
      const m = openModal({ title: "Yeni Hesaplar", body, footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Ekle ve İşle", "btn-primary", async () => {
          const types = toCreate.map((r, i) => $(`.bk-new-type[data-i="${i}"]`, body)?.value || (r.o.amt >= 0 ? "musteri" : "tedarikci"));
          m.close(); btn.disabled = true;
          try {
            const extra = [];
            for (let i = 0; i < toCreate.length; i++)
              extra.push({ o: toCreate[i].o, acc: await createBankCari(toCreate[i].val, types[i]), rapor: toCreate[i].rapor, acik: toCreate[i].acik });
            await doSave(btn, bank, bankAcc, blokeAcc, groups, [...ok, ...extra], editor);
          } catch (e) { toast("Hata: " + e.message, "err"); btn.disabled = false; }
        }),
      ]});
      return;
    }
    btn.disabled = true;
    await doSave(btn, bank, bankAcc, blokeAcc, groups, ok, editor);
  }

  async function doSave(btn, bank, bankAcc, blokeAcc, groups, assigns, editor) {
    try {
      const fresh = await fetchAll(C.accountEntries).catch(() => []);
      const posKeys = new Set(groups.map((g) => `${bank.key}|${g.dep}|${g.cek}|${g.tip}`));
      const otherKey = (o) => `${bank.key}|${o.dekont || o.dep + "|" + o.seq}`;
      const otherKeys = new Set(assigns.map((a) => otherKey(a.o)));
      const isStale = (e) =>
        ((e.source === "banka-pos" || e.source === "banka-pos-komisyon") && posKeys.has(e.posKey)) ||
        (e.source === "banka-diger" && otherKeys.has(e.otherKey));
      for (const e of fresh.filter(isStale)) await deleteDoc(doc(db, "accountEntries", e.id));
      const remaining = fresh.filter((e) => !isStale(e));
      let gno = remaining.reduce((m, e) => Math.max(m, e.islemNo || 0), 0);
      const cnoMap = new Map();
      const nextCno = (id) => {
        if (!cnoMap.has(id)) cnoMap.set(id, remaining.filter((e) => e.accountId === id).reduce((m, e) => Math.max(m, e.cariNo || 0), 0));
        const n = cnoMap.get(id) + 1; cnoMap.set(id, n); return n;
      };
      const docs = [];
      // ---- POS çözülmeleri (bloke → banka + komisyon) ----
      for (const g of groups) {
        const brut = g.net + g.kom;
        const posKey = `${bank.key}|${g.dep}|${g.cek}|${g.tip}`;
        const acik = `${fmtDateShort(g.cek)} ${g.tip} Çözüldü`;
        docs.push({
          accountId: blokeAcc.id, accountCode: blokeAcc.code, islemNo: ++gno, cariNo: nextCno(blokeAcc.id),
          date: g.dep, islemAdi: "BLOKE ÇÖZÜM", sahis: "", aciklama: acik, rapor: "",
          borc: 0, alacak: brut, faturaTuru: "", faturaNo: "",
          source: "banka-pos", posKey, banka: bank.key, createdAt: serverTimestamp(), createdBy: currentUser.email,
        });
        docs.push({
          accountId: bankAcc.id, accountCode: bankAcc.code, islemNo: ++gno,
          date: g.dep, islemAdi: "BLOKE ÇÖZÜM", sahis: "", aciklama: acik, rapor: "",
          giren: brut, cikan: 0,
          source: "banka-pos", posKey, banka: bank.key, createdAt: serverTimestamp(), createdBy: currentUser.email,
        });
        if (g.kom > 0.005) {
          docs.push({
            accountId: bankAcc.id, accountCode: bankAcc.code, islemNo: ++gno,
            date: g.dep, islemAdi: "Komisyon", sahis: "", aciklama: `${fmtDateShort(g.cek)} ${g.tip} Komisyonu`, rapor: "POS Komisyonu",
            giren: 0, cikan: g.kom,
            source: "banka-pos-komisyon", posKey, banka: bank.key, createdAt: serverTimestamp(), createdBy: currentUser.email,
          });
        }
      }
      // ---- POS dışı transferler (banka ↔ eşleşen hesap) ----
      for (const a of assigns) {
        const { o, acc, rapor } = a;
        const ok = otherKey(o), inn = o.amt >= 0, abs = Math.abs(o.amt);
        const disp = a.acik || (o.amt >= 0 ? "Gelen Eft" : "Giden Eft");
        const common = {
          date: o.dep, aciklama: disp, rapor, source: "banka-diger", otherKey: ok, banka: bank.key,
          bankaAciklama: o.desc, matchedCode: acc.code, matchedName: acc.name, dekont: o.dekont || "",
          createdAt: serverTimestamp(), createdBy: currentUser.email,
        };
        // 1) Banka tarafı (giren/çıkan) — açıklama = karşı taraf / özel not
        docs.push({ ...common, accountId: bankAcc.id, accountCode: bankAcc.code, islemNo: ++gno,
          islemAdi: "Para Transferi", sahis: acc.name, giren: inn ? abs : 0, cikan: inn ? 0 : abs });
        // 2) Eşleşen hesap tarafı: üstte cari adı, açıklama = neyle ödendiği/alındığı
        const cariStyle = isCari(acc.type) || String(acc.code || "").startsWith("108");
        const side = cariStyle
          ? { borc: inn ? 0 : abs, alacak: inn ? abs : 0 }
          : { giren: inn ? 0 : abs, cikan: inn ? abs : 0 };
        docs.push({ ...common, accountId: acc.id, accountCode: acc.code, islemNo: ++gno,
          ...(cariStyle ? { cariNo: nextCno(acc.id) } : {}),
          islemAdi: "Para Transferi", sahis: acc.name,
          aciklama: `${bank.label} ile ${inn ? "tahsil edildi" : "ödendi"}${a.acik ? " · " + a.acik : ""}`, ...side });
      }
      const impTok = "imp" + Date.now() + uid();
      docs.forEach((d) => d.impTok = impTok);
      await batchAdd(C.accountEntries, docs);
      await logAction("İçe Aktarma", "Banka", `${bank.label} · ${groups.length} POS + ${assigns.length} transfer · ${docs.length} kayıt`);
      toast(`${groups.length} POS + ${assigns.length} transfer işlendi.`, "ok");
      // İncelenecek hesaplar: transferin eşleştiği cari/gider hesapları (POS'lar banka/blokede)
      const affected = [...new Set(assigns.map((a) => a.acc.id))];
      editor.innerHTML = `<div class="notice info">✔ İşlendi: <b>${groups.length}</b> POS çözülmesi, <b>${assigns.length}</b> para transferi. İnceleme başlıyor…</div>`;
      successAnim(`${groups.length + assigns.length} kayıt işlendi`, () => afterBankImport(affected, impTok, lastBloke));
    } catch (e) { toast("Hata: " + e.message, "err"); btn.disabled = false; }
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

// ===========================================================================
//  MODÜL: TANIMLAMALAR — Gider Grupları
// ===========================================================================
const DEFAULT_EXPENSE_GROUPS = [
  { name: "Ürün Alımları", items: ["Kübban Gıda", "Güllüoğlu Gıda", "Sarf Malzemeleri", "Temizlik Giderleri", "Kırtasiye Giderleri", "Demirbaş ve M. Alımları", "Döviz Alımı"] },
  { name: "Genel Giderler", items: ["Kira", "Elektrik", "Su", "Doğalgaz"] },
  { name: "Personel Giderleri", items: ["Sabit Maaş (SGK Dahil)", "Ekstra Maaş", "Pirim", "Personel Harcamaları", "Tazminat"] },
  { name: "Hizmet Giderleri", items: ["Yazılım Programları", "İlaçlama", "Kargo", "Reklam", "Tlf-İnt", "Yakıt"] },
  { name: "Vergi Giderleri", items: [] },
  { name: "Bakım Onarım Giderleri", items: ["Bina Bakım - Onarım", "Araç Bakım - Onarım"] },
];

// Tek metin girişli küçük pencere
function textModal(title, label, value, onSave) {
  const body = document.createElement("div");
  body.innerHTML = `<div class="field"><label>${esc(label)}</label><input id="tm-in" value="${esc(value || "")}" /></div>`;
  const m = openModal({ title, body, footer: [
    mkBtn("Vazgeç", "", () => m.close()),
    mkBtn("Kaydet", "btn-primary", () => {
      const v = $("#tm-in", body).value.trim();
      if (!v) return toast("Boş olamaz.", "err");
      m.close(); onSave(v);
    }),
  ] });
  setTimeout(() => $("#tm-in", body)?.focus(), 50);
}

async function viewGiderGruplari(c) {
  const settings = await fetchAll(C.settings).catch(() => []);
  const cfg = settings.find((s) => s.id === "expenseGroups");
  let groups = cfg && Array.isArray(cfg.groups) ? cfg.groups : null;
  const save = async () => { await setDoc(doc(db, "settings", "expenseGroups"), { groups, updatedAt: serverTimestamp() }); };
  if (!groups) { groups = DEFAULT_EXPENSE_GROUPS.map((g) => ({ name: g.name, items: [...g.items] })); await save(); }
  const persist = () => save().then(render).catch((e) => toast("Hata: " + e.message, "err"));

  function render() {
    c.innerHTML = `
      <div class="notice info">🗂️ <b>Gider gruplarını</b> ve alt kalemlerini buradan tanımlayın. İleride banka ödemeleri ve raporlarda kullanılacak.</div>
      <div class="toolbar" style="margin-bottom:12px"><div class="grow"></div><button class="btn btn-primary btn-sm" id="add-grp">+ Yeni Grup</button></div>
      ${groups.map((g, gi) => `
        <div class="card eg-card">
          <div class="card-head">
            <h3>${esc(g.name)}</h3>
            <span class="hint">${g.items.length} kalem</span>
            <button class="btn btn-sm" data-editg="${gi}" title="Adı düzenle">✎</button>
            <button class="btn btn-sm btn-danger" data-delg="${gi}">Sil</button>
          </div>
          <div class="eg-items">
            ${g.items.length ? g.items.map((it, ii) => `
              <div class="eg-item"><span class="nm">${esc(it)}</span>
                <span class="act"><button class="btn btn-sm" data-edit="${gi}.${ii}">✎</button><button class="btn btn-sm btn-danger" data-del="${gi}.${ii}">✕</button></span>
              </div>`).join("") : `<div class="eg-empty">Alt kalem yok</div>`}
          </div>
          <button class="btn btn-sm eg-add" data-additem="${gi}">+ Kalem Ekle</button>
        </div>`).join("")}`;
    $("#add-grp", c).onclick = () => textModal("Yeni Grup", "Grup adı", "", (v) => { groups.push({ name: v, items: [] }); persist(); });
    $$("[data-editg]", c).forEach((b) => b.onclick = () => { const gi = +b.dataset.editg; textModal("Grup Adı", "Grup adı", groups[gi].name, (v) => { groups[gi].name = v; persist(); }); });
    $$("[data-delg]", c).forEach((b) => b.onclick = () => confirmDialog(`"${groups[+b.dataset.delg].name}" grubu silinsin mi?`, () => { groups.splice(+b.dataset.delg, 1); persist(); }));
    $$("[data-additem]", c).forEach((b) => b.onclick = () => { const gi = +b.dataset.additem; textModal("Yeni Kalem", "Kalem adı", "", (v) => { groups[gi].items.push(v); persist(); }); });
    $$("[data-edit]", c).forEach((b) => b.onclick = () => { const [gi, ii] = b.dataset.edit.split(".").map(Number); textModal("Kalem Adı", "Kalem adı", groups[gi].items[ii], (v) => { groups[gi].items[ii] = v; persist(); }); });
    $$("[data-del]", c).forEach((b) => b.onclick = () => { const [gi, ii] = b.dataset.del.split(".").map(Number); groups[gi].items.splice(ii, 1); persist(); });
  }
  render();
}

async function viewNakitAkisVeri(c) {
  const [items0, settings] = await Promise.all([
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.settings).catch(() => []),
  ]);
  const items = items0.sort((a, b) => (a.type || "").localeCompare(b.type || ""));
  const cfgDoc = settings.find((s) => s.id === "cashflow");
  const dailyIn = Object.assign({ garanti: 0, tfinans: 0, nakit: 0 }, (cfgDoc && cfgDoc.dailyIn) || {});
  c.innerHTML = `
    <div class="notice info">🔄 Her dönem tekrarlanan <b>gelir ve giderlerinizi</b> buradan tanımlayın.
      Tanımladıklarınız <b>Nakit Akış Raporu</b>'nda otomatik yer alır.</div>
    <div class="card" style="margin-bottom:14px">
      <div class="card-head"><h3>Öngörülen Günlük Giriş</h3><button class="btn btn-sm" id="di-edit">Ayarla</button></div>
      <div class="toolbar" style="margin:0;gap:14px;flex-wrap:wrap;font-size:13px">
        <span>🏦 Garanti <b id="di-garanti">${fmtNum(dailyIn.garanti)}</b> ₺</span>
        <span>🏦 T.Finans <b id="di-tfinans">${fmtNum(dailyIn.tfinans)}</b> ₺</span>
        <span>💵 Nakit <b id="di-nakit">${fmtNum(dailyIn.nakit)}</b> ₺</span>
      </div>
    </div>
    <div class="toolbar">
      <div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="cf-add">+ Yeni Tanım</button>
    </div>
    <div class="card">
      <div class="card-head"><h3>Tekrarlanan Kalemler</h3><span class="hint">${items.length} kalem</span></div>
      ${items.length ? `<div class="table-wrap"><table class="data">
        <thead><tr><th>Ad</th><th>Tür</th><th>Hesap</th><th>Gün</th><th>Rapor</th><th class="num">Tutar</th><th>Durum</th><th></th></tr></thead>
        <tbody>${items.map((x) => `<tr>
          <td><b>${esc(x.name)}</b></td>
          <td><span class="tag ${x.type==="gelir"?"ok":"red"}">${x.type==="gelir"?"Gelir":"Gider"}</span></td>
          <td>${x.account==="tfinans"?"T.Finans":x.account==="nakit"?"Nakit":"Garanti"}</td>
          <td>Ayın ${x.dayOfMonth || 1}'i</td>
          <td>${esc(x.rapor || "—")}</td>
          <td class="num">${fmtTRY(x.amount || 0)}</td>
          <td>${x.active===false?'<span class="tag warn">Pasif</span>':'<span class="tag ok">Aktif</span>'}</td>
          <td style="text-align:right">
            <button class="btn btn-sm" data-edit="${x.id}">Düzenle</button>
            <button class="btn btn-sm btn-danger" data-del="${x.id}">Sil</button>
          </td></tr>`).join("")}</tbody>
      </table></div>`
        : `<div class="empty"><div class="ico">🔄</div><p>Henüz tekrarlanan kalem tanımlanmamış.</p></div>`}
    </div>`;

  $("#di-edit", c).onclick = () => naDailyModal(dailyIn, () => {
    $("#di-garanti", c).textContent = fmtNum(dailyIn.garanti);
    $("#di-tfinans", c).textContent = fmtNum(dailyIn.tfinans);
    $("#di-nakit", c).textContent = fmtNum(dailyIn.nakit);
  });
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
    <div class="form-row">
      <div class="field"><label>Hesap</label><select id="cf-account">
        <option value="garanti" ${(item?.account||"garanti")==="garanti"?"selected":""}>Garanti</option>
        <option value="tfinans" ${item?.account==="tfinans"?"selected":""}>T.Finans</option>
        <option value="nakit" ${item?.account==="nakit"?"selected":""}>Nakit</option>
      </select></div>
      <div class="field"><label>Rapor Kodu <small>(gerçekleşen eşleşmesi)</small></label><input id="cf-rapor" value="${esc(item?.rapor || "")}" placeholder="ör. KDV / MAAŞ" /></div>
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
          account: $("#cf-account", body).value,
          rapor: $("#cf-rapor", body).value.trim(),
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
// Nakit akışta takip edilen 3 hesap
const NA_ACCS = [
  { key: "garanti", label: "Garanti",  code: "102.01" },
  { key: "tfinans", label: "T.Finans", code: "102.02" },
  { key: "nakit",   label: "Nakit",    code: "100" },
];
const naDelta = (e) => parseNum(e.giren) - parseNum(e.cikan) + parseNum(e.borc) - parseNum(e.alacak);
const isoOfD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function naOccurs(it, dom, monthOffset) {
  if ((it.dayOfMonth || 1) !== dom || monthOffset < 0) return false;
  const p = it.period || "aylik";
  if (p === "3aylik") return monthOffset % 3 === 0;
  if (p === "6aylik") return monthOffset % 6 === 0;
  if (p === "yillik") return monthOffset % 12 === 0;
  return true; // aylik / haftalik ≈ her ay o gün
}

// ===========================================================================
//  MODÜL: KÂR / ZARAR — hikâye gibi, muhasebesiz durum raporu
// ===========================================================================
const KZ_AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

async function viewKarZarar(c) {
  const [accounts, entries, settings] = await Promise.all([
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.accountEntries).catch(() => []),
    fetchAll(C.settings).catch(() => []),
  ]);
  const code = (a) => String(a.code || "");
  const isKasa = (a) => code(a).startsWith("100");
  const isBanka = (a) => code(a).startsWith("102");
  const isBloke = (a) => code(a).startsWith("108");
  const opening = (a) => parseNum(a.openingBalance != null ? a.openingBalance : (a.balance || 0));

  // Bir tarihe kadarki bakiye (tüm bakiye-etkisi accountEntries üzerinden gelir)
  const balAt = (asOfISO) => {
    const m = new Map();
    accounts.forEach((a) => m.set(a.id, opening(a)));
    entries.forEach((e) => {
      if (!e.accountId || !m.has(e.accountId)) return;
      if (asOfISO && String(e.date || "") > asOfISO) return;
      m.set(e.accountId, m.get(e.accountId) + parseNum(e.giren) - parseNum(e.cikan) + parseNum(e.borc) - parseNum(e.alacak));
    });
    return m;
  };
  const sumMap = (map, pred) => accounts.filter(pred).reduce((s, a) => s + (map.get(a.id) || 0), 0);
  const sheet = (map) => {
    const kasa = sumMap(map, isKasa), banka = sumMap(map, isBanka), bloke = sumMap(map, isBloke);
    const mus = sumMap(map, (a) => a.type === "musteri"), ted = sumMap(map, (a) => a.type === "tedarikci");
    const alacak = Math.max(0, mus) + Math.max(0, ted);
    const borc = Math.max(0, -mus) + Math.max(0, -ted);
    const varlik = kasa + banka + bloke + alacak;
    return { kasa, banka, bloke, alacak, borc, varlik, net: varlik - borc };
  };

  // Dönemler (verisi olan aylar)
  const monthSet = new Set();
  entries.forEach((e) => { const d = String(e.date || ""); if (d.length >= 7) monthSet.add(d.slice(0, 7)); });
  const months = [...monthSet].sort().reverse();
  const monthLabel = (ym) => { const [y, m] = ym.split("-"); return `${KZ_AYLAR[+m - 1]} ${y}`; };
  const lastDayISO = (ym) => { const [y, m] = ym.split("-").map(Number); return isoOfD(new Date(y, m, 0)); };
  const prevDayISO = (ym) => { const [y, m] = ym.split("-").map(Number); const d = new Date(y, m - 1, 1); d.setDate(0); return isoOfD(d); };

  const egGroups = (settings.find((s) => s.id === "expenseGroups") || {}).groups || DEFAULT_EXPENSE_GROUPS;
  const itemToGroup = {};
  egGroups.forEach((g) => (g.items || []).forEach((it) => { itemToGroup[normTr(it)] = g.name; }));

  const noData = !entries.length;
  let sel = "all";

  c.innerHTML = `
    <div class="kz">
      <div class="kz-hero"><div class="e">📊</div><div><b>Durum Raporu</b><span>Bilanço gibi ama herkesin anlayacağı dille.</span></div></div>
      ${noData ? `<div class="empty"><div class="ico">📭</div><p>Henüz veri yok. Gün sonu / banka aktarımı yapınca burası dolar.</p></div>` : `
      <div class="kz-period">
        <span class="lbl">📅 Dönem</span>
        <select id="kz-per">
          <option value="all">Tüm Zamanlar</option>
          ${months.map((ym) => `<option value="${ym}">${monthLabel(ym)}</option>`).join("")}
        </select>
      </div>
      <div id="kz-body"></div>`}
    </div>`;

  if (noData) return;

  function draw() {
    const isAll = sel === "all";
    const startISO = isAll ? null : `${sel}-01`;
    const endISO = isAll ? null : lastDayISO(sel);
    const openMap = isAll ? balAt("0000-01-01") : balAt(prevDayISO(sel));
    const endMap = isAll ? balAt(null) : balAt(endISO);
    const S0 = sheet(openMap), S1 = sheet(endMap);
    const todayISO = isoOfD(new Date());
    const sonEtiket = (isAll || endISO >= todayISO) ? "Bugün" : `${monthLabel(sel)} sonunda`;

    // Dönem akışları
    const flow = entries.filter((e) => {
      const d = String(e.date || "");
      if (startISO && d < startISO) return false;
      if (endISO && d > endISO) return false;
      return true;
    });
    let blokeGiden = 0, nakitDirekt = 0, blokeCozulen = 0, komisyon = 0;
    const gider = {};
    const addGider = (grp, ad, amt) => { const G = gider[grp] || (gider[grp] = { total: 0, items: {} }); G.total += amt; G.items[ad] = (G.items[ad] || 0) + amt; };
    flow.forEach((e) => {
      if (e.source === "gunsonu-bloke") blokeGiden += parseNum(e.borc);
      else if (e.source === "gunsonu-nakit") nakitDirekt += parseNum(e.giren);
      else if (e.source === "banka-pos" && String(e.accountCode || "").startsWith("102")) blokeCozulen += parseNum(e.giren);
      else if (e.source === "banka-tf-alma" && String(e.accountCode || "").startsWith("102") && parseNum(e.giren) > 0) blokeCozulen += parseNum(e.giren);
      else if (e.source === "banka-pos-komisyon") komisyon += parseNum(e.cikan);
      let amt = 0;
      if (e.source === "gunsonu-masraf") amt = parseNum(e.cikan);
      else if (e.source === "banka-diger" && String(e.accountCode || "").startsWith("102") && parseNum(e.cikan) > 0) amt = parseNum(e.cikan);
      else if (e.source === "banka-tf-cozum" && String(e.accountCode || "").startsWith("102") && parseNum(e.cikan) > 0) amt = parseNum(e.cikan);
      if (amt > 0) {
        const rapor = String(e.rapor || "").trim();
        const grp = itemToGroup[normTr(rapor)] || "Diğer Harcamalar";
        addGider(grp, rapor || "(belirtilmemiş)", amt);
      }
    });
    if (komisyon > 0) addGider("Kart Komisyonları", "Komisyon", komisyon);
    const giderTotal = Object.values(gider).reduce((s, g) => s + g.total, 0);
    const urunAldin = (gider["Ürün Alımları"] || {}).total || 0;
    const giderList = Object.entries(gider).sort((a, b) => b[1].total - a[1].total);
    const kazandin = blokeGiden + nakitDirekt;
    const borcFark = S1.borc - S0.borc;
    const netFark = S1.net - S0.net;
    const donemAdi = isAll ? "Bugüne kadar" : `${monthLabel(sel)} boyunca`;

    $("#kz-body", c).innerHTML = `
      <!-- 1) DÖNEM BAŞI -->
      <div class="kz-sec">
        <div class="kz-sec-h"><span>📌</span> ${isAll ? "En baştan" : "Dönem başında"} elinde ne vardı?</div>
        <div class="kz-row"><span class="l">💼 Paran <small>(kasa+banka+bloke)</small></span><b>${fmtTRY(S0.kasa + S0.banka + S0.bloke)}</b></div>
        ${S0.alacak ? `<div class="kz-row"><span class="l">🤝 Alacakların</span><b class="pos">${fmtTRY(S0.alacak)}</b></div>` : ""}
        ${S0.borc ? `<div class="kz-row"><span class="l">🧾 Borçların</span><b class="neg">−${fmtTRY(S0.borc)}</b></div>` : ""}
        <div class="kz-row tot"><span class="l">📊 Net varlığın</span><b class="${S0.net >= 0 ? "pos" : "neg"}">${fmtTRY(S0.net)}</b></div>
      </div>

      <!-- 2) BU DÖNEMDE -->
      <div class="kz-sec-h out"><span>🔄</span> ${donemAdi} ne oldu?</div>
      <div class="kz-card earn">
        <div class="kz-line"><span class="ic">💪</span> <b>${fmtTRY(kazandin)}</b> kazandın!</div>
        ${(blokeGiden || nakitDirekt) ? `<div class="kz-split">
          <div class="sp"><span class="e">🔒</span><span class="t">Karttan (blokeye gitti)</span><b>${fmtTRY(blokeGiden)}</b></div>
          <div class="sp"><span class="e">👛</span><span class="t">Direkt nakit geldi</span><b class="pos">${fmtTRY(nakitDirekt)}</b></div>
        </div>` : ""}
      </div>
      ${blokeCozulen ? `<div class="kz-card resolve"><div class="kz-line"><span class="ic">🔓</span> Eski blokeler çözülüp bankana düştü: <b class="pos">${fmtTRY(blokeCozulen)}</b></div></div>` : ""}
      <div class="kz-card spend">
        <div class="kz-line"><span class="ic">😰</span> Harcamaların: <b class="neg">${fmtTRY(giderTotal)}</b></div>
        ${giderList.length ? `<div class="kz-sub">Nerelere gitti? (dokun, aç-kapa) 👇</div>
        <div class="kz-groups">
          ${giderList.map(([grp, G], gi) => `
            <div class="kzg">
              <button class="kzg-h" data-g="${gi}"><span class="chev">▸</span><span class="nm">${esc(grp)}</span><b class="neg">${fmtTRY(G.total)}</b></button>
              <div class="kzg-items" id="kzg-${gi}">
                ${Object.entries(G.items).sort((a, b) => b[1] - a[1]).map(([ad, t]) => `<div class="kzg-i"><span>${esc(ad)}</span><b>${fmtTRY(t)}</b></div>`).join("")}
              </div>
            </div>`).join("")}
        </div>` : `<div class="kz-sub">Bu dönemde harcama görünmüyor.</div>`}
        ${urunAldin > 0 ? `<div class="kz-sub" style="margin-top:10px">🛒 Bunun <b>${fmtTRY(urunAldin)}</b> kadarı ürün alımı.</div>` : ""}
      </div>
      ${borcFark ? `<div class="kz-card ${borcFark > 0 ? "debt" : "credit"}"><div class="kz-line"><span class="ic">${borcFark > 0 ? "📉" : "📈"}</span> Borcun ${borcFark > 0 ? "arttı" : "azaldı"}: <b class="${borcFark > 0 ? "neg" : "pos"}">${borcFark > 0 ? "+" : "−"}${fmtTRY(Math.abs(borcFark))}</b></div></div>` : ""}

      <!-- 3) DURUM TABLOSU (BİLANÇO) -->
      <div class="kz-sec-h out"><span>🧮</span> Durum Tablosu <small>(${sonEtiket.toLowerCase()})</small></div>
      <div class="kz-sheet">
        <div class="kz-col assets">
          <div class="ch">💼 NEYİN VAR</div>
          <div class="ci"><span>💵 Kasa</span><b>${fmtTRY(S1.kasa)}</b></div>
          <div class="ci"><span>🏦 Bankalar</span><b>${fmtTRY(S1.banka)}</b></div>
          <div class="ci"><span>🔒 Blokede</span><b>${fmtTRY(S1.bloke)}</b></div>
          ${S1.alacak ? `<div class="ci"><span>🤝 Alacak</span><b>${fmtTRY(S1.alacak)}</b></div>` : ""}
          <div class="ci tot"><span>Toplam Varlık</span><b class="pos">${fmtTRY(S1.varlik)}</b></div>
        </div>
        <div class="kz-col debts">
          <div class="ch">🧾 NE BORCUN VAR</div>
          ${S1.borc ? `<div class="ci"><span>🧾 Tedarikçi / borç</span><b>${fmtTRY(S1.borc)}</b></div>` : `<div class="ci none"><span>Borcun yok 🎉</span><b>${fmtTRY(0)}</b></div>`}
          <div class="ci tot"><span>Toplam Borç</span><b class="neg">${fmtTRY(S1.borc)}</b></div>
        </div>
      </div>

      <!-- 4) NET -->
      <div class="kz-final ${S1.net >= 0 ? "" : "bad"}">
        <div class="ft">🏆 ${sonEtiket} her şeyi kapatsan…</div>
        <div class="big">${fmtTRY(S1.net)}</div>
        <div class="ft2">cebinde ${S1.net >= 0 ? "kalır" : "AÇIK var"}!</div>
        <div class="kz-break">💼 Varlık ${fmtTRY(S1.varlik)}${S1.borc ? ` − 🧾 Borç ${fmtTRY(S1.borc)}` : ""}${!isAll ? ` · bu dönem ${netFark >= 0 ? "📈 +" : "📉 −"}${fmtTRY(Math.abs(netFark))}` : ""}</div>
      </div>`;

    $$(".kzg-h", c).forEach((b) => b.onclick = () => {
      const g = $(`#kzg-${b.dataset.g}`, c);
      const open = g.classList.toggle("open");
      b.classList.toggle("open", open);
    });
  }

  const perSel = $("#kz-per", c);
  if (perSel) perSel.onchange = () => { sel = perSel.value; draw(); };
  draw();
}

async function viewNakitAkisRapor(c) {
  const [accounts, entries, items, settings] = await Promise.all([
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.accountEntries).catch(() => []),
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.settings).catch(() => []),
  ]);
  const cfgDoc = settings.find((s) => s.id === "cashflow");
  const dailyIn = Object.assign({ garanti: 0, tfinans: 0, nakit: 0 }, (cfgDoc && cfgDoc.dailyIn) || {});
  const accByKey = {};
  NA_ACCS.forEach((a) => { accByKey[a.key] = accounts.find((x) => String(x.code) === a.code) || null; });
  let selKey = "garanti"; const fwd = 90;

  c.innerHTML = `
    <div class="na-tabs" id="na-tabs">
      ${NA_ACCS.map((a) => `<div class="na-tab${a.key === selKey ? " on" : ""}" data-k="${a.key}"><span class="em">${a.key === "nakit" ? "💵" : "🏦"}</span>${esc(a.label)}${accByKey[a.key] ? "" : " ⚠️"}</div>`).join("")}
    </div>
    <div class="na-tbl">
      <table>
        <colgroup><col class="c-dt"><col class="c-num"><col class="c-num"><col class="c-num"></colgroup>
        <thead><tr><th class="l">Tarih</th><th class="r">Giren Tutar</th><th class="r">Çıkan Tutar</th><th class="r">Güncel Bakiye</th></tr></thead>
        <tbody id="na-tb"></tbody>
      </table>
    </div>
    <div id="na-pop"></div>
    <div class="pv-fhint" style="margin-top:10px">Giren/Çıkan'a dokun → ne olduğu çıkar. Bugüne kadar <b>gerçek</b>, sonrası <b>öngörü</b> (öngörülen giriş + tekrarlanan kalemler).</div>`;

  function compute(key) {
    const acc = accByKey[key];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const todayISO = isoOfD(now);
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const startISO = isoOfD(start);
    const end = new Date(now); end.setDate(end.getDate() + fwd);
    const es = acc ? entries.filter((e) => e.accountId === acc.id) : [];
    const byDate = {};
    es.forEach((e) => {
      const inA = parseNum(e.giren) + parseNum(e.borc), outA = parseNum(e.cikan) + parseNum(e.alacak);
      const o = byDate[e.date] || (byDate[e.date] = { in: 0, out: 0, inDet: [], outDet: [] });
      o.in += inA; o.out += outA;
      let lbl = e.aciklama || e.islemAdi || "Hareket";
      if ((lbl === "Gelen Eft" || lbl === "Giden Eft") && e.sahis) lbl = e.sahis;
      if (inA) o.inDet.push({ t: lbl, a: inA });
      if (outA) o.outDet.push({ t: lbl, a: outA });
    });
    let baseline = acc ? parseNum(acc.openingBalance) : 0;
    Object.keys(byDate).forEach((d) => { if (d < startISO) baseline += byDate[d].in - byDate[d].out; });
    const its = items.filter((x) => x.active !== false && (x.account || "garanti") === key);
    const raporDone = (rap, y, m) => rap && es.some((e) => String(e.rapor || "") === rap && e.date >= isoOfD(new Date(y, m, 1)) && e.date <= isoOfD(new Date(y, m + 1, 0)));
    let run = baseline; const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = isoOfD(d), dom = d.getDate(), future = iso > todayISO, isToday = iso === todayISO;
      const monthOffset = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
      let giren = 0, cikan = 0; const gd = [], cd = [];
      if (!future) {
        const o = byDate[iso];
        if (o) { giren = o.in; cikan = o.out; gd.push(...o.inDet); cd.push(...o.outDet); }
      } else {
        const di = parseNum(dailyIn[key]);
        if (di) { giren += di; gd.push({ t: "Öngörülen giriş", a: di }); }
        its.forEach((it) => {
          if (!naOccurs(it, dom, monthOffset)) return;
          if (raporDone(it.rapor, d.getFullYear(), d.getMonth())) return;
          const amt = parseNum(it.amount);
          if (it.type === "gelir") { giren += amt; gd.push({ t: it.name, a: amt }); }
          else { cikan += amt; cd.push({ t: it.name, a: amt }); }
        });
      }
      run += giren - cikan;
      days.push({ iso, dObj: new Date(d), future, isToday, giren, cikan, gd, cd, bal: run });
    }
    return { days };
  }

  const WK = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
  function draw() {
    const { days } = compute(selKey);
    let html = "";
    for (const r of days) {
      const gTap = r.giren && r.gd.length, cTap = r.cikan && r.cd.length;
      html += `<tr class="${r.future ? "fut" : ""}${r.isToday ? " today" : ""}">
        <td class="dt l">${fmtDate(r.iso).slice(0, 5)}<small>${WK[r.dObj.getDay()]}</small></td>
        <td class="gir r ${r.giren ? (gTap ? "tap" : "") : "z"}" ${gTap ? `data-x='${JSON.stringify({ dt: fmtDate(r.iso).slice(0, 5), t: "Giren", d: r.gd }).replace(/'/g, "&#39;")}'` : ""}>${r.giren ? fmtNum(r.giren) : "—"}</td>
        <td class="cik r ${r.cikan ? (cTap ? "tap" : "") : "z"}" ${cTap ? `data-x='${JSON.stringify({ dt: fmtDate(r.iso).slice(0, 5), t: "Çıkan", d: r.cd }).replace(/'/g, "&#39;")}'` : ""}>${r.cikan ? fmtNum(r.cikan) : "—"}</td>
        <td class="bal r ${r.bal < 0 ? "neg" : ""}">${fmtNum(r.bal)}</td>
      </tr>`;
    }
    $("#na-tb").innerHTML = html;
    wirePop();
  }

  const pop = () => $("#na-pop");
  function closePop() { pop().style.display = "none"; }
  function wirePop() {
    const T = $("#na-tb");
    T.onclick = (e) => {
      const td = e.target.closest("td.tap"); if (!td) { closePop(); return; }
      e.stopPropagation();
      const d = JSON.parse(td.dataset.x.replace(/&#39;/g, "'"));
      const list = d.d.slice().sort((a, b) => b.a - a.a);
      const P = pop();
      P.innerHTML = `<div class="pt">${d.dt} · ${d.t}</div><ul>${list.map((x) => `<li>${esc(x.t)}: ${fmtNum(x.a)} ₺</li>`).join("")}</ul>`;
      P.style.display = "block"; P.style.visibility = "hidden";
      const rect = td.getBoundingClientRect(), pw = Math.min(P.offsetWidth, 250);
      let left = Math.max(8, Math.min(rect.left + rect.width / 2 - pw / 2, window.innerWidth - pw - 8));
      let top = rect.top - P.offsetHeight - 10; if (top < 8) top = rect.bottom + 10;
      P.style.left = left + "px"; P.style.top = top + "px"; P.style.visibility = "visible";
    };
  }

  $$("#na-tabs .na-tab", c).forEach((t) => t.onclick = () => {
    selKey = t.dataset.k;
    $$("#na-tabs .na-tab", c).forEach((x) => x.classList.toggle("on", x === t));
    closePop(); draw();
  });
  document.addEventListener("click", (e) => { if (!e.target.closest("#na-pop") && !e.target.closest("#na-tb")) closePop(); });
  draw();
}

// Öngörülen günlük giriş ayarı (settings/cashflow)
function naDailyModal(dailyIn, onSave) {
  const body = document.createElement("div");
  body.innerHTML = `
    <div class="mg-note">Her gün her hesaba beklediğin ortalama giriş (ciro tahmini). Bakiyeye eklenir.</div>
    ${["garanti", "tfinans", "nakit"].map((k) => `
      <div class="field"><label>${k === "garanti" ? "Garanti" : k === "tfinans" ? "T.Finans" : "Nakit"} — günlük giriş (₺)</label>
        <input class="num di-in" data-k="${k}" inputmode="decimal" value="${dailyIn[k] ? fmtNum(dailyIn[k]) : ""}" placeholder="0,00" /></div>`).join("")}`;
  const m = openModal({ title: "Öngörülen Günlük Giriş", body, footer: [
    mkBtn("Vazgeç", "", () => m.close()),
    mkBtn("Kaydet", "btn-primary", async () => {
      $$(".di-in", body).forEach((inp) => { dailyIn[inp.dataset.k] = parseNum(inp.value); });
      try {
        await setDoc(doc(db, "settings", "cashflow"), { dailyIn, updatedAt: serverTimestamp() });
        m.close(); toast("Kaydedildi.", "ok"); onSave && onSave();
      } catch (e) { toast("Hata: " + e.message, "err"); }
    }),
  ] });
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
  const stats = await storageStats();
  const kb = (stats.bytes / 1024).toFixed(1);
  c.innerHTML = `
    <div class="notice info">☁️ <b>Bulut mod (Supabase) aktif.</b> Veriler Supabase veritabanında saklanıyor ve cihazlar arasında paylaşılıyor.
      Yine de arada bir <b>yedek indirmek</b> iyidir. Yerel bir yedeği buradan geri yükleyebilirsiniz.</div>
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

  $("#yd-export").onclick = async () => {
    const btn = $("#yd-export"); btn.disabled = true; const old = btn.textContent; btn.textContent = "Hazırlanıyor…";
    try {
      const data = await exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `kubban-yedek-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Yedek indirildi.", "ok");
    } catch (e) { toast("Yedek alınamadı: " + e.message, "err"); }
    finally { btn.disabled = false; btn.textContent = old; }
  };
  $("#yd-import-btn").onclick = () => $("#yd-import").click();
  $("#yd-import").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      confirmDialog("Bu yedek mevcut verinin ÜZERİNE yazılacak. Devam edilsin mi?", async () => {
        const lb = loadingBar("Yedek yükleniyor…");
        try { await importAll(payload, { replace: true }); lb.finish(() => { toast("Yedek geri yüklendi.", "ok"); route(); }); }
        catch (err) { lb.finish(() => toast("Yükleme hatası: " + err.message, "err")); }
      });
    } catch (err) { toast("Geçersiz yedek dosyası.", "err"); }
  };
  $("#yd-clear").onclick = () =>
    confirmDialog("TÜM veriler silinsin mi? Bu işlem geri alınamaz.", async () => {
      try { await clearAllData(); toast("Tüm veri temizlendi.", "ok"); route(); }
      catch (e) { toast("Hata: " + e.message, "err"); }
    });
}

// ===========================================================================
//  MODÜL: KULLANICILAR (yönetici — Supabase Edge Function ile)
// ===========================================================================
async function viewUsers(c) {
  if (!isAdmin()) {
    c.innerHTML = `<div class="notice warn">⚠️ Bu sayfa yalnızca yöneticilere açıktır.</div>`;
    return;
  }
  c.innerHTML = `<div class="empty"><div class="spinner" style="margin:0 auto"></div><p>Kullanıcılar yükleniyor…</p></div>`;
  let users = [];
  try {
    const res = await adminUsers("list");
    users = res.users || [];
  } catch (e) {
    c.innerHTML = `<div class="notice warn">Kullanıcılar alınamadı: ${esc(e.message)}<br>
      <small>Supabase'de <code>admin-users</code> fonksiyonu deploy edildi mi?</small></div>`;
    return;
  }
  users.sort((a, b) => (a.email || "").localeCompare(b.email || ""));

  const rows = users.map((u) => `<tr>
    <td>${esc(u.email || "")}${u.id === currentUser.uid ? ` <span class="role-badge">sen</span>` : ""}</td>
    <td>${esc(u.displayName || "—")}</td>
    <td><span class="role-badge${u.role === "admin" ? "" : " user"}">${u.role === "admin" ? "Yönetici" : "Kullanıcı"}</span></td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn btn-sm" data-role="${u.id}" data-cur="${u.role}">${u.role === "admin" ? "Kullanıcı yap" : "Yönetici yap"}</button>
      <button class="btn btn-sm" data-pw="${u.id}">Şifre</button>
      ${u.id === currentUser.uid ? "" : `<button class="btn btn-sm btn-danger" data-del="${u.id}" data-mail="${esc(u.email || "")}">Sil</button>`}
    </td>
  </tr>`).join("");

  c.innerHTML = `
    <div class="toolbar"><div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="us-new">+ Yeni Kullanıcı</button></div>
    <div class="card">
      <div class="card-head"><h3>Kullanıcılar</h3><span class="hint">${users.length} kişi</span></div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>E-posta</th><th>Ad</th><th>Rol</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4"><div class="empty">Kayıt yok.</div></td></tr>`}</tbody>
      </table></div>
      <div class="pv-fhint" style="margin-top:10px">Kayıt olma kapalı; yeni kişileri buradan eklersin. Şifreyi sen belirlersin, kullanıcıya iletirsin.</div>
    </div>`;

  $("#us-new", c).onclick = () => {
    const body = document.createElement("div");
    body.innerHTML = `
      <div class="field"><label>E-posta</label><input id="nu-mail" type="email" placeholder="ad@ornek.com" /></div>
      <div class="field"><label>Ad (görünecek isim)</label><input id="nu-name" type="text" placeholder="Ad Soyad" /></div>
      <div class="field"><label>Şifre (en az 6 karakter)</label><input id="nu-pass" type="text" placeholder="şifre" /></div>
      <div class="field"><label>Rol</label>
        <select id="nu-role"><option value="user">Kullanıcı</option><option value="admin">Yönetici</option></select></div>`;
    const m = openModal({ title: "Yeni Kullanıcı", body, footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Oluştur", "btn-primary", async () => {
        const email = $("#nu-mail", body).value.trim();
        const displayName = $("#nu-name", body).value.trim();
        const password = $("#nu-pass", body).value;
        const role = $("#nu-role", body).value;
        if (!email || password.length < 6) return toast("E-posta ve en az 6 karakterli şifre gerekli.", "err");
        m.close();
        const lb = loadingBar("Kullanıcı oluşturuluyor…");
        try { await adminUsers("create", { email, password, displayName, role }); lb.finish(() => { toast("Kullanıcı oluşturuldu.", "ok"); route(); }); }
        catch (e) { lb.finish(() => toast("Hata: " + e.message, "err")); }
      }),
    ]});
  };

  $$("[data-role]", c).forEach((b) => b.onclick = () => {
    const id = b.dataset.role, next = b.dataset.cur === "admin" ? "user" : "admin";
    confirmDialog(`Rol '${next === "admin" ? "Yönetici" : "Kullanıcı"}' yapılsın mı?`, async () => {
      try { await adminUsers("setRole", { id, role: next }); toast("Rol güncellendi.", "ok"); route(); }
      catch (e) { toast("Hata: " + e.message, "err"); }
    });
  });
  $$("[data-pw]", c).forEach((b) => b.onclick = () => {
    const id = b.dataset.pw;
    const body = document.createElement("div");
    body.innerHTML = `<div class="field"><label>Yeni şifre (en az 6 karakter)</label><input id="pw-new" type="text" placeholder="yeni şifre" /></div>`;
    const m = openModal({ title: "Şifre Değiştir", body, footer: [
      mkBtn("Vazgeç", "", () => m.close()),
      mkBtn("Kaydet", "btn-primary", async () => {
        const password = $("#pw-new", body).value;
        if (password.length < 6) return toast("En az 6 karakter.", "err");
        m.close();
        try { await adminUsers("setPassword", { id, password }); toast("Şifre güncellendi.", "ok"); }
        catch (e) { toast("Hata: " + e.message, "err"); }
      }),
    ]});
  });
  $$("[data-del]", c).forEach((b) => b.onclick = () =>
    confirmDialog(`'${b.dataset.mail}' kullanıcısı silinsin mi? Geri alınamaz.`, async () => {
      try { await adminUsers("delete", { id: b.dataset.del }); toast("Kullanıcı silindi.", "ok"); route(); }
      catch (e) { toast("Hata: " + e.message, "err"); }
    }));
}

// ===========================================================================
//  MODÜL: DEĞİŞİKLİK KAYDI (audit log)
// ===========================================================================
const ACTION_TAG = { "Ekleme": "ok", "Düzenleme": "gold", "Silme": "red" };
async function viewAuditLog(c) {
  const logs = (await fetchAll(C.auditLog).catch(() => []))
    .sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  const fmtWhen = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString("tr-TR");
  };
  c.innerHTML = `
    <div class="notice info">📋 Yapılan <b>ekleme, düzenleme ve silme</b> işlemleri burada tutulur — hangi kullanıcı, ne zaman, neyi değiştirdi.</div>
    <div class="toolbar">
      <div class="grow"></div>
      ${logs.length ? `<button class="btn btn-sm btn-danger" id="audit-clear">Kaydı Temizle</button>` : ""}
    </div>
    <div class="card">
      <div class="card-head"><h3>İşlem Geçmişi</h3><span class="hint">${logs.length} kayıt</span></div>
      ${logs.length ? `
        <div class="ledger-cards">
          ${logs.map((l) => `<div class="tx-card" style="cursor:default">
            <div class="tx-left">
              <div class="tx-title">${esc(l.entity || "")} <span class="tag ${ACTION_TAG[l.action]||'gold'}" style="margin-left:4px">${esc(l.action || "")}</span></div>
              <div class="tx-sub">${esc(l.userName || l.user || "?")} · ${esc(fmtWhen(l.at))}</div>
              ${l.label ? `<div class="tx-desc">${esc(l.label)}</div>` : ""}
            </div>
          </div>`).join("")}
        </div>
        <div class="table-wrap ledger-table"><table class="data">
          <thead><tr><th>Tarih / Saat</th><th>Kullanıcı</th><th>İşlem</th><th>Tür</th><th>Kayıt</th></tr></thead>
          <tbody>${logs.map((l) => `<tr>
            <td>${esc(fmtWhen(l.at))}</td>
            <td>${esc(l.userName || l.user || "?")}</td>
            <td><span class="tag ${ACTION_TAG[l.action]||'gold'}">${esc(l.action || "")}</span></td>
            <td>${esc(l.entity || "")}</td>
            <td>${esc(l.label || "")}</td>
          </tr>`).join("")}</tbody>
        </table></div>`
        : `<div class="empty"><div class="ico">📋</div><p>Henüz kayıt yok. İşlem yaptıkça burada görünecek.</p></div>`}
    </div>`;

  const clr = $("#audit-clear");
  if (clr) clr.onclick = () => confirmDialog("Tüm değişiklik kaydı silinsin mi?", async () => {
    for (const l of logs) await deleteDoc(doc(db, "auditLog", l.id));
    toast("Kayıt temizlendi.", "ok"); route();
  });
}

// ===========================================================================
//  MODÜL: GÜNCELLEME / SÜRÜM
// ===========================================================================
// Önbelleği temizleyip uygulamayı en güncel sürümle yeniden yükle
async function doAppUpdate(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Güncelleniyor…"; }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (_) { /* yoksay */ }
  // Benzersiz sorgu ile HTML'yi taze indir; index güncel ?v ile app.js'i tazeler
  const fresh = location.pathname + "?u=" + Date.now() + (location.hash || "#/guncelleme");
  location.replace(fresh);
}

async function viewGuncelleme(c) {
  const cur = CHANGELOG[0] || { version: APP_VERSION, date: todayISO(), items: [] };
  c.innerHTML = `
    <div class="card" style="margin-bottom:18px">
      <div class="card-head"><h3>Uygulama Güncelleme</h3><span class="hint">En son sürümü yükle</span></div>
      <p style="margin:0 0 12px;color:var(--ink-soft);font-size:13px">
        Yeni bir sürüm yayınlandığında, tarayıcı önbelleğini atlayıp en güncel sürümü yüklemek için butona basın.
        (Artık <b>Ctrl+F5</b> gerekmez.)
      </p>
      <button class="btn btn-primary" id="app-update">🔄 Uygulamayı Güncelle</button>
    </div>
    <div class="grid cols-3">
      <div class="stat"><div class="label">Güncel Sürüm</div><div class="value">${esc(APP_VERSION)}</div><div class="foot">${fmtDate(cur.date)}</div></div>
      <div class="stat green"><div class="label">Yayın</div><div class="value" style="font-size:19px">Canlı</div><div class="foot">GitHub Pages · Bulut (Supabase)</div></div>
      <div class="stat"><div class="label">Toplam Sürüm</div><div class="value">${CHANGELOG.length}</div><div class="foot">Düzen: YIL.NO (artan)</div></div>
    </div>
    <div class="card" style="margin-top:18px">
      <div class="card-head"><h3>Sürüm Geçmişi</h3><span class="hint">En yeni sürüm üstte</span></div>
      <div class="note-list">
        ${CHANGELOG.map((v, i) => `
          <div class="note" style="border-left-color:${i === 0 ? "var(--gold)" : "var(--line-strong)"}">
            <div class="meta">
              <b style="color:var(--gold-dark);font-size:13.5px">Sürüm ${esc(v.version)}</b>
              &nbsp;·&nbsp;${fmtDate(v.date)}
              ${i === 0 ? '<span class="tag ok" style="margin-left:6px">güncel</span>' : ""}
            </div>
            <ul style="margin:6px 0 0;padding-left:18px;color:var(--ink)">
              ${(v.items || []).map((it) => `<li style="margin:2px 0">${esc(it)}</li>`).join("")}
            </ul>
          </div>`).join("")}
      </div>
    </div>`;

  $("#app-update").onclick = (e) =>
    confirmDialog("Uygulama en güncel sürüme yenilenecek. Devam edilsin mi?",
      () => doAppUpdate(e.target));
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
//  ANA EKRANA EKLE — kurulum rehberi (iOS anlatım + Android tek-dokunuş)
// ---------------------------------------------------------------------------
function initA2HS() {
  const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (standalone || localStorage.getItem("a2hs-dismiss") === "1") return;
  const ua = navigator.userAgent || "";
  const isIOS = /iphone|ipad|ipod/i.test(ua);
  const isAndroid = /android/i.test(ua);
  const isRealSafari = isIOS && /Version\/\d+/.test(ua) && /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS|GSA)/.test(ua);
  if (!isIOS && !isAndroid) return; // masaüstünde gösterme

  const el = document.createElement("div");
  el.className = "a2hs";
  const msg = isIOS
    ? (isRealSafari
        ? `Alttaki <b>Paylaş ⬆︎</b> → <b>“Ana Ekrana Ekle”</b>`
        : `Sağ alttaki <b>•••</b> → <b>“Safari’de Aç”</b>, sonra <b>Paylaş</b> → <b>“Ana Ekrana Ekle”</b>`)
    : `Menü <b>⋮</b> → <b>“Ana ekrana ekle / Uygulamayı yükle”</b>`;
  el.innerHTML = `
    <img class="ico" src="apple-touch-icon.jpg?v=${APP_VERSION}" alt="" />
    <div class="txt"><b>Kübban’ı ana ekrana ekle</b><span id="a2hs-msg">${msg}</span></div>
    <button class="add hidden" id="a2hs-add">Ekle</button>
    <button class="x" id="a2hs-x" aria-label="Kapat">✕</button>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));

  const close = (remember) => { el.classList.remove("show"); if (remember) localStorage.setItem("a2hs-dismiss", "1"); setTimeout(() => el.remove(), 300); };
  el.querySelector("#a2hs-x").onclick = () => close(true);

  // Android/Chrome: gerçek kurulum istemi
  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); deferred = e;
    const btn = el.querySelector("#a2hs-add"); const m = el.querySelector("#a2hs-msg");
    btn.classList.remove("hidden"); if (m) m.textContent = "Tek dokunuşla kur:";
    btn.onclick = async () => { deferred.prompt(); const r = await deferred.userChoice; deferred = null; if (r.outcome === "accepted") close(true); };
  });
  window.addEventListener("appinstalled", () => close(true));
}
setTimeout(initA2HS, 900);

// ---------------------------------------------------------------------------
//  BAŞLAT
// ---------------------------------------------------------------------------
setupAuthUI();
if (CONFIG_READY) {
  onAuth();
} else {
  showLogin(); // config eksik → giriş ekranında uyarı gösterilir
}
