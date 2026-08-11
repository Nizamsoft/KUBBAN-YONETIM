-- =====================================================================
--  GÜLLÜOĞLU KÜBBAN — Supabase kurulum SQL'i
--  Supabase panel → SQL Editor → yapıştır → Run.
--  Her koleksiyon bir tablo: (id text pk, doc jsonb, created_at).
--  RLS açık; sadece GİRİŞ YAPMIŞ (authenticated) kullanıcılar erişir.
-- =====================================================================

do $$
declare
  t text;
  names text[] := array[
    'users','accounts','accountEntries','dayEndRecords',
    'currentMovements','bankTransactions','cashflowItems','settings','auditLog'
  ];
begin
  foreach t in array names loop
    -- Tablo
    execute format(
      'create table if not exists %I (
         id text primary key,
         doc jsonb not null default ''{}''::jsonb,
         created_at timestamptz not null default now()
       );', t);

    -- Satır güvenliği
    execute format('alter table %I enable row level security;', t);

    -- Politika: giriş yapmış herkes okuyup yazabilir (tek şirket içi kullanım)
    execute format('drop policy if exists p_auth_all on %I;', t);
    execute format(
      'create policy p_auth_all on %I
         for all
         to authenticated
         using (true)
         with check (true);', t);
  end loop;
end $$;

-- =====================================================================
--  NOTLAR
--  • Supabase panel → Authentication → Providers → Email açık olmalı.
--  • Hızlı başlangıç için: Authentication → Settings → "Confirm email"
--    KAPALI yap (yoksa kayıt sonrası e-posta onayı beklenir, giriş
--    yapılamaz). İç kullanım için kapalı olması pratiktir.
--  • İlk admin: uygulamanın giriş ekranından "Kayıt Ol" ile hesabı aç;
--    e-posta config.js → BOOTSTRAP_ADMINS listesindeyse rol otomatik
--    "admin" olur.
-- =====================================================================
