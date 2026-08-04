# Güllüoğlu Kübban — Veri Modeli (Firestore)

Bu proje **kendine ait, bağımsız** bir Firebase projesi kullanır (Nizam Soft - To Do
ile paylaşılmaz). Aşağıda kullanılan koleksiyonlar ve alanları özetlenmiştir.

> Tüm para alanları TL cinsinden `number`, tarihler `YYYY-MM-DD` string olarak tutulur.
> `createdAt`/`updatedAt` alanları Firestore `serverTimestamp()` ile yazılır.

---

## `users/{uid}`
Uygulama kullanıcıları. Firebase Auth `uid` ile eşleşir.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `email` | string | Kullanıcı e-postası |
| `displayName` | string | Ad soyad |
| `role` | `"admin"` \| `"user"` | **admin = Yetkili Kişi** (Gün Sonu kayıtlarını düzenler) |
| `createdAt` | timestamp | Oluşturulma |

> İlk yönetici, `config.js > BOOTSTRAP_ADMINS` listesine e-posta eklenerek ya da
> Firestore Console'dan `role: "admin"` yapılarak belirlenir.

---

## `dayEndRecords/{id}` — Gün Sonu Kayıtları
Satış programından aktarılan gün sonu verisinin arşivi. (Aktarım Ekranı buraya yazar.)

| Alan | Tip | Açıklama |
|------|-----|----------|
| `date` | string (YYYY-MM-DD) | Gün sonu tarihi (gün başına tek kayıt) |
| `rows` | array<object> | Excel satırları (başlık→değer nesneleri) |
| `headers` | array<string> | Sütun başlıkları |
| `totalColumn` | string | Toplam alınan sütun adı |
| `total` | number | Toplam ciro |
| `rowCount` | number | Satır sayısı |
| `status` | `"aktarildi"` \| `"onaylandi"` | Durum |
| `notes` | array<{text, by, at}> | Gün Sonu Raporu notları |
| `createdBy` / `updatedBy` | string | E-posta |
| `createdAt` / `updatedAt` | timestamp | |

---

## `accounts/{id}` — Hesaplar
Kullanıcının görüntülediği hesap planı (100 Kasa, 320 Tedarikçiler, vb.).

| Alan | Tip | Açıklama |
|------|-----|----------|
| `code` | string | Hesap kodu (ör. `100.01`, `320.05`) |
| `name` | string | Hesap adı |
| `type` | `kasa`\|`banka`\|`tedarikci`\|`musteri`\|`gider`\|`diger` | Hesap türü |
| `balance` | number | Güncel bakiye |
| `createdAt`/`updatedAt` | timestamp | |

---

## `currentMovements/{id}` — Cari Hareketler
Uyumsoft cari hareket Excel'inden aktarılan hareketler.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `date` | string | Hareket tarihi |
| `code` | string | Cari kod |
| `name` | string | Cari / açıklama |
| `debit` | number | Borç |
| `credit` | number | Alacak |
| `source` | string | `"uyumsoft-cari"` |
| `createdBy` / `createdAt` | | |

---

## `bankTransactions/{id}` — Banka Hareketleri
Banka dosyalarından aktarılan hareketler.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `date` | string | Tarih |
| `desc` | string | Açıklama |
| `type` | `"gelen"` \| `"giden"` | Yön |
| `amount` | number | Tutar (giden negatif) |
| `balance` | number | O anki bakiye |
| `source` | string | `"banka"` |

---

## `cashflowItems/{id}` — Nakit Akış Verileri
Her dönem tekrarlanan gelir/gider tanımları. Nakit Akış Raporu bunları baz alır.

| Alan | Tip | Açıklama |
|------|-----|----------|
| `name` | string | Kalem adı (Kira, Personel, vb.) |
| `type` | `"gelir"` \| `"gider"` | |
| `period` | `haftalik`\|`aylik`\|`3aylik`\|`6aylik`\|`yillik` | Tekrar dönemi |
| `amount` | number | Tutar |
| `dayOfMonth` | number (1-31) | Ayın hangi günü |
| `active` | boolean | Rapora dahil mi |

---

## Ekran ↔ Koleksiyon Haritası

| Ekran | Okur | Yazar |
|-------|------|-------|
| Dashboard | accounts, dayEndRecords, cashflowItems | — |
| Gün Sonu · Aktarım | — | dayEndRecords |
| Gün Sonu · Kayıtlar | dayEndRecords | dayEndRecords (admin) |
| Gün Sonu · Rapor | dayEndRecords | dayEndRecords.notes |
| Hesaplar | accounts | accounts |
| Cari Hareket | — | currentMovements |
| Banka İşleme | — | bankTransactions |
| Nakit Akış Verileri | cashflowItems | cashflowItems |
| Nakit Akış Raporu | cashflowItems, accounts | — |
