// ============================================================================
//  GÜLLÜOĞLU KÜBBAN — Edge Function: admin-users
//  Yönetici kullanıcı yönetimi (listele / oluştur / sil / rol / şifre).
//  Gizli service_role anahtarı SADECE burada (sunucuda) kullanılır — tarayıcıya
//  asla gitmez. Çağıran kişinin gerçekten yönetici olduğu doğrulanır.
//  Deploy: Supabase panel → Edge Functions → yeni fonksiyon adı "admin-users".
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 👇 Yönetici e-postaları — yeni yönetici eklemek istersen buraya ekleyip
//    fonksiyonu yeniden deploy et.
const ADMIN_EMAILS = ["nizamsoft@icloud.com"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown) =>
  new Response(JSON.stringify(obj), { headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Çağıranı doğrula (JWT sahte olamaz)
    //    Token'ı Authorization başlığından ayıklayıp getUser'a AÇIKÇA veriyoruz;
    //    argümansız getUser() istemcinin oturumunu arar (fonksiyonda yok) ve
    //    "giriş yok" döndürür. Token'ı elle geçirmek güvenilir yoldur.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Yetkisiz (token yok)." });
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: uerr } = await caller.auth.getUser(token);
    if (uerr || !user) return json({ error: "Yetkisiz (giriş yok)." });
    const email = (user.email || "").toLowerCase();
    if (!ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email))
      return json({ error: "Bu işlem yalnızca yöneticiye açık." });

    // 2) Yönetici işlemleri için gizli anahtarlı istemci (sunucuda)
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "list") {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const { data: rows } = await admin.from("users").select("id,doc");
      const roleById: Record<string, string> = {};
      (rows || []).forEach((r: any) => (roleById[r.id] = r.doc?.role || "user"));
      const users = data.users.map((u: any) => ({
        id: u.id,
        email: u.email,
        displayName: u.user_metadata?.displayName || "",
        role: roleById[u.id] || "user",
        createdAt: u.created_at,
      }));
      return json({ users });
    }

    if (action === "create") {
      const e = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const displayName = String(body.displayName || "").trim();
      const role = body.role === "admin" ? "admin" : "user";
      if (!e || !password) return json({ error: "E-posta ve şifre gerekli." });
      if (password.length < 6) return json({ error: "Şifre en az 6 karakter olmalı." });
      const { data, error } = await admin.auth.admin.createUser({
        email: e, password, email_confirm: true, user_metadata: { displayName },
      });
      if (error) return json({ error: error.message });
      const uid = data.user.id;
      await admin.from("users").upsert({
        id: uid,
        doc: { email: data.user.email, displayName, role, createdAt: new Date().toISOString() },
      });
      // ÖNEMLİ: Güvenlik (RLS) 'approved_users' listesine bağlı. Yeni kullanıcı
      // bu listeye eklenmezse giriş yapar ama HİÇBİR veri göremez. Otomatik ekle.
      const { error: apErr } = await admin.from("approved_users").upsert({ uid, email: data.user.email });
      if (apErr) return json({ ok: true, id: uid, warn: "Kullanıcı oluşturuldu fakat onaylı listeye (approved_users) eklenemedi: " + apErr.message + " — SQL ile elle ekleyin, yoksa veri göremez." });
      return json({ ok: true, id: uid });
    }

    if (action === "delete") {
      const id = String(body.id || "");
      if (!id) return json({ error: "id gerekli." });
      if (id === user.id) return json({ error: "Kendini silemezsin." });
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message });
      await admin.from("users").delete().eq("id", id);
      await admin.from("approved_users").delete().eq("uid", id);   // onaylı listesinden de çıkar
      return json({ ok: true });
    }

    if (action === "setRole") {
      const id = String(body.id || "");
      const role = body.role === "admin" ? "admin" : "user";
      if (!id) return json({ error: "id gerekli." });
      const { data: cur } = await admin.from("users").select("doc").eq("id", id).maybeSingle();
      await admin.from("users").upsert({ id, doc: { ...(cur?.doc || {}), role } });
      return json({ ok: true });
    }

    if (action === "setPassword") {
      const id = String(body.id || "");
      const password = String(body.password || "");
      if (!id || password.length < 6) return json({ error: "id ve en az 6 karakterli şifre gerekli." });
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) return json({ error: error.message });
      return json({ ok: true });
    }

    return json({ error: "Bilinmeyen işlem." });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) });
  }
});
