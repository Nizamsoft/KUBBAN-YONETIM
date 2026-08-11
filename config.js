// ============================================================================
//  GÜLLÜOĞLU KÜBBAN — YÖNETİM YAZILIMI  ·  YAPILANDIRMA (CONFIG)
// ============================================================================
//  Bu proje "Nizam Soft - To Do" uygulamasından TAMAMEN AYRI ve BAĞIMSIZDIR.
//  Aşağıya YENİ oluşturduğunuz (kübban'a ait) Firebase projesinin bilgilerini
//  girin. Firebase Console > Project Settings > General > "Your apps" > SDK
//  setup and configuration > "Config" bölümündeki değerleri kopyalayın.
//
//  ÖNEMLİ: Bu değerler eski/başka bir projeye ait OLMAMALIDIR.
// ============================================================================

export const firebaseConfig = {
  apiKey: "BURAYA_API_KEY_GIRIN",
  authDomain: "PROJE-ID.firebaseapp.com",
  projectId: "PROJE-ID",
  storageBucket: "PROJE-ID.appspot.com",
  messagingSenderId: "MESSAGING_SENDER_ID",
  appId: "APP_ID",
};

// -------- SUPABASE --------
// Supabase panel → Settings → API'den:
//   Project URL  → SUPABASE_URL
//   anon public  → SUPABASE_ANON_KEY   (public'tir, tarayıcıda görünür; güvenlik RLS ile sağlanır)
// Sadece app.js "supabase-backend.js"e geçirildiğinde kullanılır.
export const SUPABASE_URL = "https://yyznpveudtqqklzpucay.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_w5e64_NcGifq-qWlakAdkQ__B39piwH";

// Firmaya ait sabitler (arayüzde kullanılır)
export const COMPANY = {
  name: "Güllüoğlu Kübban",
  subtitle: "Gaziantep Mutfağı",
  logo:
    "https://firebasestorage.googleapis.com/v0/b/nizam--to-do.firebasestorage.app/o/company-logos%2FahknZI41JjoHGdkfyy8W%2Fphoto.jpg?alt=media&token=2b3ea8e5-90ba-4299-8cb4-5681c646baf9",
};

// Yönetici (yetkili) yetkisi kontrolü:
// Bir kullanıcının Firestore'daki users/{uid}.role alanı "admin" ise
// Gün Sonu kayıtlarını düzenleyebilir/silebilir. Aşağıdaki e-postalar ise
// ilk girişte otomatik olarak admin rolü ile oluşturulur (isteğe bağlı kolaylık).
export const BOOTSTRAP_ADMINS = [
  "nizamsoft@icloud.com",
];
