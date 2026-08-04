# Güllüoğlu Kübban — Yönetim Yazılımı

Gaziantep Mutfağı **Güllüoğlu Kübban** için geliştirilen; gün sonu, hesap takibi,
cari/banka veri girişi ve nakit akışı yönetim paneli.

> ⚠️ Bu proje **"Nizam Soft - To Do"** uygulamasından tamamen ayrı, bağımsız bir
> yazılımdır. Kendi GitHub reposunu ve **kendi Firebase projesini** kullanır;
> veriler ve kullanıcılar karışmaz.

## Çalışma Modu

> 🟢 **Şu an YEREL MOD aktif.** Tüm veriler (kullanıcılar dahil) yalnızca
> **tarayıcının belleğinde** (`localStorage`) saklanır. Firebase **gerekmez**;
> `config.js` doldurmadan çalışır. Firebase'i **en sona** bağlayacağız.
>
> - Giriş de yereldir: ilk kez **Kayıt olun** ile hesap oluşturun.
> - Veri kaybını önlemek için **Sistem → Yedek / Veri** ekranından düzenli
>   yedek indirin. Firebase bağlanınca bu yedeği içe aktarabilirsiniz.
>
> **Firebase'e geçiş** (ileride): `app.js`'in en üstündeki import'u
> `./local-backend.js` yerine gstatic Firebase SDK adreslerine çevirin ve
> `config.js`'e proje bilgilerini girin. Fonksiyon imzaları birebir aynıdır.

## Teknoloji
- Saf **HTML + CSS + vanilla JavaScript** (framework yok)
- Veri katmanı: **yerel mod** (`local-backend.js`, localStorage) — sonradan **Firebase** (Auth + Firestore)
- Excel okuma: [SheetJS](https://sheetjs.com) (CDN üzerinden, tarayıcıda)

## Dosya Yapısı
```
index.html   → uygulama iskeleti (giriş + panel)
style.css    → tema (logo paletine göre altın/kırmızı/krem)
app.js       → tüm uygulama mantığı (auth, router, modüller)
config.js    → ⚙️ Firebase bilgilerini BURAYA girersiniz
firestore.rules → Firestore güvenlik kuralları
DATA-MODEL.md   → koleksiyon/alan şeması
```

## Hızlı Başlangıç (Yerel Mod)

Firebase'e gerek yok. Basit bir sunucu yeterli (`file://` ile **açılmaz**):
```bash
python3 -m http.server 8080      # veya:  npx serve .
```
Tarayıcıda **http://localhost:8080** → **Kayıt olun** ile ilk kullanıcıyı oluşturun.

---

## Firebase Kurulumu (İLERİDE — şimdilik atlayın)

### 1) Yeni Firebase projesi oluşturun
1. [Firebase Console](https://console.firebase.google.com) → **Add project**
   (Kübban'a özel yeni bir proje; mevcut projeleri kullanmayın).
2. **Build > Authentication > Sign-in method** → **Email/Password**'ü etkinleştirin.
3. **Build > Firestore Database** → veritabanı oluşturun (production mode).
4. **Project Settings > General > Your apps** → Web app (`</>`) ekleyin ve
   **firebaseConfig** değerlerini kopyalayın.

### 2) `config.js` dosyasını doldurun
Kopyaladığınız değerleri `config.js` içindeki `firebaseConfig` nesnesine yapıştırın.
Yönetici e-postasını `BOOTSTRAP_ADMINS` listesine ekleyebilirsiniz.

### 3) Güvenlik kurallarını uygulayın
`firestore.rules` içeriğini **Firestore Database > Rules** bölümüne yapıştırıp yayınlayın.

### 4) Çalıştırın
Statik dosyalar olduğu için basit bir sunucu yeterlidir:
```bash
# Python
python3 -m http.server 8080
# veya Node
npx serve .
```
Tarayıcıda `http://localhost:8080` → **Kayıt olun** ile ilk kullanıcıyı oluşturun.
`BOOTSTRAP_ADMINS` içine e-postanızı eklediyseniz otomatik **yönetici** olursunuz.

### 5) (İsteğe bağlı) Yayınlama
Firebase Hosting ile: `firebase init hosting` → `firebase deploy`.

## Modüller
- **Dashboard** — kasa/banka/tedarikçi özetleri, aylık nakit akış, son gün sonları
- **Gün Sonu** — Aktarım (Excel içe aktar), Kayıtlar (arşiv, yalnızca yetkili düzenler), Rapor (inceleme + not)
- **Hesaplar** — 100 Kasa, 320 Tedarikçi vb. hesap yönetimi
- **Veri Girişi** — Cari Hareket (Uyumsoft Excel), Banka İşleme (dosya yükle + ön izleme)
- **Raporlar** — Nakit Akış Raporu (1/3/6/12 aylık projeksiyon), Nakit Akış Verileri (tekrarlanan kalemler)

## Yetkilendirme
- **Yönetici (admin):** Gün Sonu kayıtlarını düzenleyip silebilir.
- **Kullanıcı (user):** Görüntüleme + veri girişi yapabilir.

Rol, `users/{uid}.role` alanında tutulur.
