# Supabase'e Geçiş Rehberi

Uygulama tüm veriyi `local-backend.js` üzerinden okuyor. Supabase'e geçmek =
aynı API'yi Supabase ile dolduran `supabase-backend.js`'e geçmek. app.js'te
**tek satır** değişir.

## 1) Supabase projesi
1. https://supabase.com → yeni proje aç.
2. **Settings → API**: `Project URL` ve `anon public` anahtarını kopyala.
3. `config.js` içine yaz:
   ```js
   export const SUPABASE_URL = "https://xxxx.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJhbGciOi...";
   ```

## 2) Tablolar + güvenlik (RLS)
- Supabase → **SQL Editor** → `supabase-setup.sql` içeriğini yapıştır → **Run**.
- Bu; her koleksiyon için `(id, doc jsonb, created_at)` tablosu açar ve RLS'i
  "sadece giriş yapmış kullanıcı" olarak ayarlar.

## 3) Kimlik doğrulama (Auth)
- **Authentication → Providers → Email** açık olsun.
- Hızlı başlangıç: **Authentication → Settings → "Confirm email" KAPALI**
  (yoksa kayıttan sonra e-posta onayı beklenir).
- İlk admin: uygulama giriş ekranından **Kayıt Ol**. E-posta
  `config.js → BOOTSTRAP_ADMINS` içindeyse rol otomatik **admin** olur.

## 4) Backend'i değiştir
`app.js` en üstteki import:
```js
} from "./local-backend.js?v=...";
```
şununla değiştir:
```js
} from "./supabase-backend.js?v=...";
```

## 5) Mevcut veriyi taşı (localStorage → Supabase)
1. **Eski (localStorage) sürümde**: Sistem → Yedek Al → JSON dosyasını indir.
2. Backend'i Supabase'e geçir (adım 4), yayına al.
3. Supabase'te **Kayıt Ol / Giriş yap**.
4. Sistem → **Yedek Yükle** → o JSON'u seç. `importAll` verileri Supabase'e
   yazar.

## Notlar
- `anon key` public'tir (tarayıcıda görünür) — güvenlik **RLS + Auth** ile
  sağlanır, sorun değil.
- Supabase `select` varsayılan 1000 satırla sınırlı; adapter sayfalayarak
  hepsini çeker (accounts 1000+ olsa bile).
- Sorgular şimdilik tabloyu çekip JS'te süzülür (uygulamanın mevcut davranışı).
  İleride ağırlaşırsa `where`/`orderBy` doğrudan Postgres'e taşınabilir.
