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
} from "./local-backend.js?v=2026.49";

import { COMPANY, BOOTSTRAP_ADMINS } from "./config.js?v=2026.49";

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
  accountEntries:   () => collection(db, "accountEntries"),
  dayEndRecords:    () => collection(db, "dayEndRecords"),
  currentMovements: () => collection(db, "currentMovements"),
  bankTransactions: () => collection(db, "bankTransactions"),
  cashflowItems:    () => collection(db, "cashflowItems"),
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
function advanceReview() {
  if (!reviewQueue) return;
  reviewQueue.index++;
  if (reviewQueue.index >= reviewQueue.ids.length) {
    reviewQueue = null;
    toast("Tüm cari hesaplar incelendi. ✔", "ok");
    location.hash = "#/hesaplar";
  } else {
    location.hash = "#/hesap-detay?id=" + reviewQueue.ids[reviewQueue.index];
  }
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
  $("#user-avatar").textContent = (currentUser.displayName || currentUser.email || "?")
    .trim().charAt(0).toUpperCase();
  const roleEl = $("#user-role");
  roleEl.textContent = isAdmin() ? "Yönetici" : "Kullanıcı";
  roleEl.classList.toggle("user", !isAdmin());
  const foot = $(".sidebar-foot");
  if (foot) foot.textContent = `Sürüm ${APP_VERSION} · Yerel Mod`;
  buildNav();
  if (!location.hash) location.hash = "#/dashboard";
  route();
}
$("#user-chip").addEventListener("click", () => {
  confirmDialog("Oturumu kapatmak istiyor musunuz?", () => signOut(auth));
});

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
const APP_VERSION = "2026.49";
const CHANGELOG = [
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
    { label: "Nakit Akış Raporu",   icon: "📈", path: "nakit-akis-rapor" },
    { label: "Nakit Akış Verileri", icon: "🔄", path: "nakit-akis-veri" },
    { label: "Gün Sonu Raporu",     icon: "📄", path: "gunsonu-rapor" },
  ]},
  { label: "Sistem", icon: "⚙️", children: [
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
  "hesap-detay":      { title: "Hesap Hareketleri", crumb: "Hesaplar", render: viewAccountLedger },
  "cari-hareket":     { title: "Fatura Aktarımı", crumb: "Veri Girişleri", render: viewCariHareket },
  "banka":            { title: "Banka Aktarımı", crumb: "Veri Girişleri", render: viewBanka },
  "nakit-akis-rapor": { title: "Nakit Akış Raporu", crumb: "Raporlar", render: viewNakitAkisRapor },
  "nakit-akis-veri":  { title: "Nakit Akış Verileri", crumb: "Raporlar", render: viewNakitAkisVeri },
  "yedek":            { title: "Yedek / Veri", crumb: "Sistem", render: viewYedek },
  "guncelleme":       { title: "Güncelleme", crumb: "Sistem", render: viewGuncelleme },
  "audit":            { title: "Değişiklik Kaydı", crumb: "Sistem", render: viewAuditLog },
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

async function route() {
  const path = (location.hash.replace(/^#\/?/, "") || "dashboard").split("?")[0];
  const r = ROUTES[path] || ROUTES["dashboard"];
  closeDrawer(); // mobilde gezinince menüyü kapat
  if (reviewKeyHandler) { document.removeEventListener("keydown", reviewKeyHandler); reviewKeyHandler = null; }
  const navPath = path === "hesap-detay" ? "hesaplar"
    : path === "gunsonu-kayitlar" ? "gunsonu-aktarim" : path;
  $$("#nav .nav-item").forEach((a) =>
    a.classList.toggle("active", a.dataset.path === navPath));
  // Aktif sayfanın bulunduğu grubu aç (akordeon)
  $$("#nav .nav-group").forEach((g) =>
    g.classList.toggle("open", Array.isArray(g._paths) && g._paths.includes(navPath)));
  $("#page-title").textContent = r.title;
  $("#crumb").textContent = r.crumb;
  const c = $("#view-container");
  try {
    await r.render(c);
    // Yumuşak, anlık geçiş (spinner titremesi olmadan)
    c.style.animation = "none";
    void c.offsetWidth;
    c.style.animation = "viewIn .16s ease-out";
  } catch (err) {
    console.error(err);
    c.innerHTML = `<div class="notice warn"><b>Hata:</b> ${esc(err.message || err)}</div>`;
  }
}
// requestAnimationFrame ile kısıtlama (akıcı yeniden hesaplama için)
function rafThrottle(fn) {
  let scheduled = false;
  return (...a) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; fn(...a); });
  };
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
  // raw:true → sayılar gerçek sayı olarak gelir (yerel format karışıklığı olmaz),
  // metin hücreleri (ör. VKN baştaki sıfırlarıyla) string kalır.
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });
  // İlk boş olmayan satırı başlık kabul et
  let headerIdx = aoa.findIndex((r) => r.some((c) => String(c).trim() !== ""));
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
  .toLowerCase().replace(/\s+/g, " ").trim();
// Başlık düzeni: TÜMÜ BÜYÜK olsa bile "İlk Harfler Büyük" (kelime başları), gerisi küçük
function titleCase(s) {
  return String(s || "").toLowerCase()
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
      out.push({ code: m.code, name, aciklama: "Kredi Kartı", tip: "kredi", manual: true, borc: kredi, ger });
      out.push({ code: m.code, name, aciklama: "Debit Kartı", tip: "debit", manual: true, borc: debit, ger });
      out.push({ code: m.code, name, aciklama: "Yurt Dışı", tip: "yurtdisi", manual: false, borc: ger - kredi - debit, ger });
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
        toast("Rapor okundu.", "ok");
        goto(1);
      } catch (e) { toast("Okunamadı: " + e.message, "err"); }
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
    };
    body.addEventListener("input", rafThrottle(recompute));
    $$(".gs-real", body).forEach((inp) => inp.addEventListener("blur", () => {
      if (inp.value.trim() !== "") inp.value = fmtNum(parseNum(inp.value));
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
    const dups = [];
    cariItems.forEach((it) => {
      const acc = byName.get(normTr(it.name)); if (!acc) return;
      const dup = preEntries.some((e) => e.accountId === acc.id && e.date === date && e.gunSonuKey !== date &&
        parseNum(it.side === "borc" ? e.borc : e.alacak) === it.tutar && it.tutar);
      if (dup) dups.push(`${it.name} · ${fmtTRY(it.tutar)} · ${it.side === "borc" ? "Borç" : "Alacak"}`);
    });

    const doCommit = async () => {
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
        // 3) Bloke (108) + Nakit (100) + Cari (120) hareketleri (hepsi idempotent)
        await postBlokeEntries(date, blokePayload);
        await postCariEntries(date, cariItems, byName);
        await logAction(editing ? "Düzenleme" : "Ekleme", "Gün Sonu", fmtDate(date));
        toast("Gün sonu kaydedildi.", "ok");
        gsState = null;
        location.hash = "#/gunsonu-kayitlar";
      } catch (e) { toast("Kaydedilemedi: " + e.message, "err"); }
    };

    if (missing.length || dups.length) {
      const bodyEl = document.createElement("div");
      bodyEl.innerHTML =
        (missing.length ? `<div style="margin-bottom:10px"><b>🆕 Şu cariler yok, otomatik oluşturulacak:</b><ul style="margin:6px 0 0;padding-left:20px">${missing.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>` : "") +
        (dups.length ? `<div class="notice warn" style="margin:0"><b>⚠️ Aynı tarih ve tutarda zaten kayıt var:</b><ul style="margin:6px 0 0;padding-left:20px">${dups.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>Yine de eklensin mi?</div>` : "");
      const m = openModal({ title: "Cari Kayıtları — Onay", body: bodyEl, footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Onayla ve Kaydet", "btn-primary", () => { m.close(); doCommit(); }),
      ]});
      return;
    }
    doCommit();
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
        aciklama: `${fmtDate(date)} Gün Sonu ${it.side === "borc" ? "Kredili Satış" : "Tahsilat"}`,
        borc: it.side === "borc" ? it.tutar : 0,
        alacak: it.side === "alacak" ? it.tutar : 0,
        faturaTuru: "", faturaNo: "",
        source: "gunsonu-cari", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      });
    }
    if (docs.length) await batchAdd(C.accountEntries, docs);
  }

  // Bloke satırlarını 108 hesap defterlerine yazar; aynı güne ait öncekileri siler.
  async function postBlokeEntries(date, blokePayload) {
    const accounts = await ensureBlokeAccounts();
    const codeToId = {}, codeToName = {};
    accounts.forEach((a) => { if (a.code) { codeToId[String(a.code)] = a.id; codeToName[String(a.code)] = a.name; } });

    const existing = await fetchAll(C.accountEntries).catch(() => []);
    const isStale = (e) => (e.source === "gunsonu-bloke" || e.source === "gunsonu-nakit") && e.gunSonuKey === date;
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
        aciklama: `${fmtDate(date)} ${cekimAd(r)} Çekimi`, rapor: "",
        borc: parseNum(r.borc), alacak: 0,
        faturaTuru: "", faturaNo: fmtDate(rv),
        source: "gunsonu-bloke", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      };
    }).filter(Boolean);

    // Nakit (Gerçekleşen) → 100 Kasa Hesabı'na Giren, aynı tarzda açıklamayla
    const nakitRow = (gsState.kasa || []).find((r) => normTr(r.yontem) === "nakit");
    const nakit = nakitRow && !(nakitRow.gerceklesen === "" || nakitRow.gerceklesen == null) ? parseNum(nakitRow.gerceklesen) : 0;
    const kasaId = codeToId["100"];
    if (kasaId && nakit) {
      gno++;
      docs.push({
        accountId: kasaId, accountCode: "100",
        islemNo: gno,
        date: blokePayload.tarih,
        islemAdi: "Gün Sonu", sahis: "",
        aciklama: `${fmtDate(date)} Nakit Girişi`, rapor: "",
        giren: nakit, cikan: 0,
        source: "gunsonu-nakit", gunSonuKey: date,
        createdAt: serverTimestamp(), createdBy: currentUser.email,
      });
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
  roots.sort(byCode);
  kids.forEach((arr) => arr.sort(byCode));

  const cur = (a) => balances.get(a.id)?.current || 0;
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
      <button class="btn btn-sm" id="acc-complete" style="display:none">⤓ Varsayılanları Tamamla</button>
      <button class="btn btn-sm" id="acc-add" style="display:none">＋ Yeni Hesap</button>
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
  };
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

  // Mobil: banka uygulaması tarzı hareket kartları
  const ledgerEmpty = `<div class="empty" style="padding:28px"><div class="ico">🧾</div><p>Henüz hareket yok. <b>+ Yeni Hareket</b> ile ekleyin.</p></div>`;
  const kasaCard = ({ e, bakiye }) => `
    <button class="tx-card" data-edit="${e.id}">
      <div class="tx-left">
        <div class="tx-title">${esc(e.islemAdi || "Hareket")}</div>
        <div class="tx-sub">${fmtDate(e.date)} · No ${esc(String(e.islemNo ?? "—"))}${e.sahis ? " · " + esc(e.sahis) : ""}</div>
        ${e.aciklama ? `<div class="tx-desc">${esc(e.aciklama)}</div>` : ""}
      </div>
      <div class="tx-right">
        ${e.giren ? `<div class="tx-amt in">+${fmtTRY(parseNum(e.giren))}</div>` : ""}
        ${e.cikan ? `<div class="tx-amt out">−${fmtTRY(parseNum(e.cikan))}</div>` : ""}
        <div class="tx-bal">Bakiye ${fmtTRY(bakiye)}</div>
      </div>
    </button>`;
  const cariCard = ({ e, bakiye }) => `
    <button class="tx-card" data-edit="${e.id}">
      <div class="tx-left">
        <div class="tx-title">${esc(e.sahis || e.aciklama || "Hareket")}</div>
        <div class="tx-sub">${fmtDate(e.date)} · Cari ${esc(String(e.cariNo ?? "—"))} · No ${esc(String(e.islemNo ?? "—"))}</div>
        ${e.aciklama && e.sahis ? `<div class="tx-desc">${esc(e.aciklama)}</div>` : ""}
        ${(e.faturaTuru || e.faturaNo) ? `<div class="tx-tag">🧾 ${esc(e.faturaTuru || "")}${e.faturaNo ? " · " + esc(e.faturaNo) : ""}</div>` : ""}
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

  const backBar = reviewBar + `
    <div class="toolbar">
      <a class="btn btn-sm" href="#/hesaplar">← Hesaplar</a>
      <div class="grow"></div>
      <button class="btn btn-primary btn-sm" id="add-entry">+ Yeni Hareket</button>
    </div>`;

  if (cari) {
    const totBorc = list.reduce((s, e) => s + parseNum(e.borc), 0);
    const totAlacak = list.reduce((s, e) => s + parseNum(e.alacak), 0);
    c.innerHTML = backBar + `
      <div class="grid cols-2" style="margin-bottom:18px">
        <div class="stat"><div class="label">Hesap</div><div class="value" style="font-size:17px">${esc(acc.name || "")}</div><div class="foot">${esc(acc.code || "")}</div></div>
        <div class="stat"><div class="label">Güncel Bakiye</div><div class="value" style="color:${run<0?'var(--danger)':'inherit'}">${fmtTRY(Math.abs(run))}</div><div class="foot">${run>=0?"Borç":"Alacak"} bakiye</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Cari Hareketler</h3><span class="hint">${list.length} hareket</span></div>
        <div class="ledger-cards">${rows.length ? rows.map(cariCard).join("") : ledgerEmpty}</div>
        <div class="table-wrap ledger-table"><table class="data">
          <thead><tr>
            <th>İşlem No</th><th>Cari No</th><th>Tarih</th><th>Şahıs</th><th>Açıklama</th>
            <th class="num">Borç</th><th class="num">Alacak</th><th class="num">Güncel Bakiye</th>
            <th>Fatura Türü</th><th>Fatura No</th><th></th>
          </tr></thead>
          <tbody>${rows.length ? rows.map(({ e, bakiye }) => `<tr>
            <td><b>${esc(String(e.islemNo ?? "—"))}</b></td>
            <td>${esc(String(e.cariNo ?? "—"))}</td>
            <td>${fmtDate(e.date)}</td>
            <td>${esc(e.sahis || "")}</td>
            <td>${esc(e.aciklama || "")}</td>
            <td class="num">${e.borc ? fmtTRY(parseNum(e.borc)) : "—"}</td>
            <td class="num">${e.alacak ? fmtTRY(parseNum(e.alacak)) : "—"}</td>
            <td class="num" style="font-weight:700;color:${bakiye<0?'var(--danger)':'inherit'}">${fmtTRY(bakiye)}</td>
            <td>${esc(e.faturaTuru || "")}</td>
            <td>${esc(e.faturaNo || "")}</td>
            <td style="text-align:right"><button class="btn btn-sm" data-edit="${e.id}">Düzenle</button></td>
          </tr>`).join("") : `<tr><td colspan="11"><div class="empty"><div class="ico">🧾</div><p>Henüz hareket yok. <b>+ Yeni Hareket</b> ile ekleyin.</p></div></td></tr>`}
          </tbody>
          ${rows.length ? `<tfoot><tr style="font-weight:700;background:var(--surface-2)">
            <td colspan="5">Toplam</td>
            <td class="num">${fmtTRY(totBorc)}</td>
            <td class="num">${fmtTRY(totAlacak)}</td>
            <td class="num">${fmtTRY(run)}</td><td colspan="3"></td>
          </tr></tfoot>` : ""}
        </table></div>
      </div>`;
  } else {
    const totGiren = list.reduce((s, e) => s + parseNum(e.giren), 0);
    const totCikan = list.reduce((s, e) => s + parseNum(e.cikan), 0);
    c.innerHTML = backBar + `
      <div class="grid cols-4" style="margin-bottom:18px">
        <div class="stat"><div class="label">Hesap</div><div class="value" style="font-size:19px">${esc(acc.code || "")}</div><div class="foot">${esc(acc.name || "")}</div></div>
        <div class="stat green"><div class="label">Toplam Giren</div><div class="value">${fmtTRY(totGiren)}</div></div>
        <div class="stat red"><div class="label">Toplam Çıkan</div><div class="value">${fmtTRY(totCikan)}</div></div>
        <div class="stat"><div class="label">Güncel Bakiye</div><div class="value" style="color:${run<0?'var(--danger)':'inherit'}">${fmtTRY(run)}</div><div class="foot">Açılış: ${fmtTRY(opening)}</div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3>Hareketler</h3><span class="hint">${list.length} hareket</span></div>
        <div class="ledger-cards">${rows.length ? rows.map(kasaCard).join("") : ledgerEmpty}</div>
        <div class="table-wrap ledger-table"><table class="data">
          <thead><tr>
            <th>İşlem No</th><th>Tarih</th><th>İşlem Adı</th><th>Şahıs</th><th>Açıklama</th><th>Rapor</th>
            <th class="num">Giren Tutar</th><th class="num">Çıkan Tutar</th><th class="num">Güncel Bakiye</th><th></th>
          </tr></thead>
          <tbody>${rows.length ? rows.map(({ e, bakiye }) => `<tr>
            <td><b>${esc(String(e.islemNo ?? "—"))}</b></td>
            <td>${fmtDate(e.date)}</td>
            <td>${esc(e.islemAdi || "")}</td>
            <td>${esc(e.sahis || "")}</td>
            <td>${esc(e.aciklama || "")}</td>
            <td>${esc(e.rapor || "")}</td>
            <td class="num" style="color:var(--ok)">${e.giren ? fmtTRY(parseNum(e.giren)) : "—"}</td>
            <td class="num" style="color:var(--danger)">${e.cikan ? fmtTRY(parseNum(e.cikan)) : "—"}</td>
            <td class="num" style="font-weight:700;color:${bakiye<0?'var(--danger)':'inherit'}">${fmtTRY(bakiye)}</td>
            <td style="text-align:right"><button class="btn btn-sm" data-edit="${e.id}">Düzenle</button></td>
          </tr>`).join("") : `<tr><td colspan="10"><div class="empty"><div class="ico">🧾</div><p>Henüz hareket yok. <b>+ Yeni Hareket</b> ile ekleyin.</p></div></td></tr>`}
          </tbody>
          ${rows.length ? `<tfoot><tr style="font-weight:700;background:var(--surface-2)">
            <td colspan="6">Toplam</td>
            <td class="num" style="color:var(--ok)">${fmtTRY(totGiren)}</td>
            <td class="num" style="color:var(--danger)">${fmtTRY(totCikan)}</td>
            <td class="num">${fmtTRY(run)}</td><td></td>
          </tr></tfoot>` : ""}
        </table></div>
      </div>`;
  }

  $("#add-entry").onclick = () => entryModal(acc, null, { nextNo, nextCariNo });
  $$("[data-edit]", c).forEach((b) => b.onclick = () =>
    entryModal(acc, list.find((e) => e.id === b.dataset.edit), { nextNo, nextCariNo }));

  // İnceleme turu: Sonraki / Bitir + Enter kısayolu
  if (inReview) {
    $("#rev-next").onclick = advanceReview;
    $("#rev-finish").onclick = () => { reviewQueue = null; location.hash = "#/hesaplar"; };
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

  c.innerHTML = `
    <div class="card" style="padding:12px"><div id="ch-drop"></div></div>
    <div id="ch-editor"></div>`;

  $("#ch-drop").appendChild(fileDrop(async (file) => {
    try {
      const { headers, rows } = await parseSpreadsheet(file);
      if (!rows.length) return toast("Veri bulunamadı.", "err");
      askType(headers, rows);
    } catch (e) { toast("Okunamadı: " + e.message, "err"); }
  }, ".xlsx,.xls,.csv", true));

  function askType(headers, rows) {
    const m = openModal({
      title: "Fatura Türü",
      body: `<p style="margin:0 0 10px">${rows.length} fatura bulundu. Bu faturaları hangi tür olarak işleyelim?</p>
        <div style="font-size:12.5px;color:var(--ink-soft);line-height:1.7">
          • <b>Alış Faturası</b> → 320 Tedarikçiler · tutar <b>Alacak</b>'a<br>
          • <b>Satış Faturası</b> → 120 Alıcılar · tutar <b>Borç</b>'a
        </div>`,
      footer: [
        mkBtn("Vazgeç", "", () => m.close()),
        mkBtn("Satış Faturası", "", () => { m.close(); buildPreview(headers, rows, "satis"); }),
        mkBtn("Alış Faturası", "btn-primary", () => { m.close(); buildPreview(headers, rows, "alis"); }),
      ],
    });
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

    const findAcc = (it) =>
      cariAccounts.find((a) => a.vkn && it.vkn && String(a.vkn) === it.vkn) ||
      cariAccounts.find((a) => nrm(a.name) === nrm(it.ad));
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
        code, name: it.ad || "Yeni Cari", type: main.type,
        parentId: main.id, parentCode: main.code, vkn: it.vkn || "",
        openingBalance: 0, createdAt: serverTimestamp(),
      };
      const ref = await addDoc(C.accounts(), payload);
      const newAcc = { id: ref.id, ...payload };
      accounts.push(newAcc); cariAccounts.push(newAcc);
      await logAction("Ekleme", "Cari Hesap", `${code} ${payload.name}`);
      if (!silent) { toast("Cari eklendi: " + payload.name, "ok"); draw(); }
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

    // Sıra sıra soran sihirbaz: Açık / Kapalı / Kısmi Kapat
    function runWizard(indices) {
      if (!indices.length) { draw(); return; }
      let k = 0, keyH = null;
      const body = document.createElement("div");
      const finish = () => { if (keyH) document.removeEventListener("keydown", keyH); m.close(); draw(); };
      const m = openModal({ title: "Fatura Durumu", body, footer: [mkBtn("Bitir", "", finish)] });
      const choose = (w, amt) => {
        const it = items[indices[k]];
        it.durum = w;
        it.kismiTutar = w === "kismi" ? Math.min(amt || 0, it.amount) : 0;
        k++; step();
      };
      function step() {
        if (k >= indices.length) { finish(); return; }
        const it = items[indices[k]];
        body.innerHTML = `
          <div style="font-size:12px;color:var(--ink-faint)">${k + 1}/${indices.length}</div>
          <div style="font-weight:700;font-size:15px;margin-top:4px">${esc(it.ad || "-")}</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin:4px 0 14px">${esc(it.faturaNo)} · ${fmtDate(it.date)} · Tutar <b>${fmtTRY(it.amount)}</b></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-primary" data-w="acik">Açık ↵</button>
            <button class="btn" data-w="kapali">Kapalı</button>
            <button class="btn" data-w="kismi">Kısmi Kapat</button>
          </div>
          <div id="wz-kismi" style="display:none;margin-top:14px">
            ${moneyField(kind === "satis" ? "Tahsil Edilen (Alacak)" : "Ödenen (Borç)", "wz-amount", "")}
            <button class="btn btn-primary btn-sm" id="wz-ok">Devam</button>
          </div>`;
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
        e.preventDefault(); choose("acik");
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
      const badgeOf = (s, i) => s.code === "ready" ? `<span class="tag ok">${esc(s.acc.code)} · ${esc(s.acc.name)}</span>`
        : s.code === "dup" ? `<span class="tag warn">Zaten var</span>`
        : `<span class="tag red">Cari yok</span> <button class="btn btn-sm" data-addcari="${i}">+ Cari Ekle</button>`;

      const rowsHtml = items.map((it, i) => {
        const a = amountsOf(it), d = durumInfo(it);
        return `<tr data-ask="${i}" style="cursor:pointer">
          <td>${esc(it.faturaNo)}</td><td>${fmtDate(it.date)}</td><td>${esc(it.ad)}</td><td>${esc(it.vkn)}</td>
          <td class="num">${a.borc ? fmtTRY(a.borc) : "—"}</td>
          <td class="num">${a.alacak ? fmtTRY(a.alacak) : "—"}</td>
          <td><span class="tag ${d.tag}">${d.label}</span></td>
          <td>${badgeOf(st[i], i)}</td>
        </tr>`;
      }).join("");

      const cardsHtml = items.map((it, i) => {
        const a = amountsOf(it), d = durumInfo(it);
        return `<div class="tx-card" data-ask="${i}">
          <div class="tx-left">
            <div class="tx-title">${esc(it.ad || "-")}</div>
            <div class="tx-sub">${esc(it.faturaNo)} · ${fmtDate(it.date)}</div>
            <div class="tx-desc">Borç ${fmtTRY(a.borc)}${a.alacak ? ` · Alacak ${fmtTRY(a.alacak)}` : ""}</div>
            <div style="margin-top:6px">${badgeOf(st[i], i)}</div>
          </div>
          <div class="tx-right"><span class="tag ${d.tag}">${d.label}</span></div>
        </div>`;
      }).join("");

      editor.innerHTML = `
        <div class="card">
          <div class="card-head"><h3>Önizleme · ${faturaTuru}</h3>
            <span class="hint">${esc(main.code)} ${esc(main.name)} · ${items.length} fatura</span></div>
          <div class="toolbar" style="margin:0 0 12px">
            <span class="tag ok">${ready} işlenecek</span>
            <span class="tag warn">${dups} zaten var</span>
            <span class="tag red">${noc} cari yok</span>
            <div class="grow"></div>
            <button class="btn btn-sm" id="reask">Durumları Sor</button>
            ${noc ? `<button class="btn btn-sm" id="add-all-cari">Eksik carileri oluştur</button>` : ""}
          </div>
          <div class="ledger-cards">${cardsHtml}</div>
          <div class="table-wrap ledger-table"><table class="data">
            <thead><tr><th>Fatura No</th><th>Tarih</th><th>Cari Adı</th><th>VKN/TCKN</th>
              <th class="num">Borç</th><th class="num">Alacak</th><th>Durum</th><th>Cari Hesap</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table></div>
          <div class="toolbar" style="margin-top:14px">
            <div class="grow"></div>
            <button class="btn btn-primary" id="send-inv" ${ready ? "" : "disabled"}>📤 ${ready} Faturayı İşle</button>
          </div>
        </div>`;

      $$("[data-ask]", editor).forEach((el) => el.addEventListener("click", (e) => {
        if (e.target.closest("button")) return;
        askOne(+el.dataset.ask);
      }));
      $("#reask", editor).onclick = () => runWizard(nonDupIdx());
      $$("[data-addcari]", editor).forEach((b) => b.onclick = () => createCari(items[+b.dataset.addcari]));
      const addAll = $("#add-all-cari", editor);
      if (addAll) addAll.onclick = async () => {
        addAll.disabled = true;
        const seen = new Set();
        for (const it of items) {
          if (statusOf(it).code !== "nocari") continue;
          const key = it.vkn || nrm(it.ad);
          if (seen.has(key)) continue;
          seen.add(key);
          await createCari(it, true);
        }
        toast("Eksik cariler oluşturuldu.", "ok"); draw();
      };
      const send = $("#send-inv", editor);
      if (send) send.onclick = () => onSend(send);
    }

    async function onSend(sendBtn) {
      sendBtn.disabled = true;
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
      try {
        await batchAdd(C.accountEntries, docs);
        await logAction("İçe Aktarma", "Cari Fatura", `${main.code} ${main.name} · ${docs.length} ${faturaTuru}`);
        toast(`${docs.length} fatura işlendi. İnceleme turu başlıyor…`, "ok");
        // İşlenen carilere tek tek gidilecek inceleme turu
        const affected = [...new Set(docs.map((d) => d.accountId))];
        reviewQueue = { ids: affected, index: 0 };
        location.hash = "#/hesap-detay?id=" + affected[0];
      } catch (e) { toast("Hata: " + e.message, "err"); sendBtn.disabled = false; }
    }

    // Otomatik: önce sıra sıra durum sor (mükerrer olmayanlar), sonra önizleme
    const startIdx = nonDupIdx();
    if (startIdx.length) runWizard(startIdx); else draw();
  }
}

// ===========================================================================
//  MODÜL: BANKA İŞLEME
// ===========================================================================
async function viewBanka(c) {
  const allAcc = await fetchAll(C.accounts).catch(() => []);
  const parentIds = new Set(allAcc.map((a) => a.parentId).filter(Boolean));
  // Yalnızca alt hesabı olmayan (yaprak) banka hesapları — ör. 102.01 Garanti
  const bankAccounts = allAcc.filter((a) => a.type === "banka" && !parentIds.has(a.id));
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
    editor.addEventListener("input", rafThrottle(recompute));
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
  const [items, accounts, cari, bank, entries] = await Promise.all([
    fetchAll(C.cashflowItems).catch(() => []),
    fetchAll(C.accounts).catch(() => []),
    fetchAll(C.currentMovements).catch(() => []),
    fetchAll(C.bankTransactions).catch(() => []),
    fetchAll(C.accountEntries).catch(() => []),
  ]);
  const bal = computeBalances(accounts, cari, bank, entries);
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
      <div class="stat green"><div class="label">Yayın</div><div class="value" style="font-size:19px">Canlı</div><div class="foot">GitHub Pages · Yerel Mod</div></div>
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
//  BAŞLAT
// ---------------------------------------------------------------------------
setupAuthUI();
if (CONFIG_READY) {
  onAuth();
} else {
  showLogin(); // config eksik → giriş ekranında uyarı gösterilir
}
