-- =====================================================================
--  GÜLLÜOĞLU KÜBBAN — GÜVENLİK SIKILAŞTIRMA (RLS ALLOW-LIST)
--  Supabase panel → SQL Editor → bu dosyanın TAMAMINI yapıştır → Run.
--
--  AMAÇ:  Biri KAYIT OLSA BİLE, sen ONAYLAMADIKÇA HİÇBİR veriyi göremez /
--         yazamaz / silemez. (Eski politika "giriş yapan herkes her şeyi
--         görür" idi — bu tehlikeliydi; artık yalnız ONAYLI kullanıcılar.)
--
--  MANTIK:  approved_users tablosundaki uid'ler = erişebilenler.
--           Bu tabloyu SADECE sen (SQL editor / Supabase paneli) değiştirir;
--           uygulamadan (anon/authenticated) DEĞİŞTİRİLEMEZ.
-- =====================================================================

-- 1) Onaylı kullanıcılar tablosu ---------------------------------------
create table if not exists public.approved_users (
  uid   uuid primary key,
  email text,
  added_at timestamptz not null default now()
);
alter table public.approved_users enable row level security;
-- BİLEREK politika eklenmiyor: RLS açık + politika yok = uygulamadan erişilemez.
-- Yalnız SQL editor / service_role okur-yazar. (Kimse kendini onaylayamaz.)

-- 2) Yardımcı: şu anki kullanıcı onaylı mı? ----------------------------
create or replace function public.is_approved()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$ select exists (select 1 from public.approved_users where uid = auth.uid()); $$;
revoke all on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

-- 3) TÜM veri tablolarında politikayı "yalnız ONAYLI kullanıcı"ya indir -
--    (users tablosu hariç: yeni kullanıcı giriş yapıp KENDİ satırını
--     oluşturabilsin diye — ama başka hiçbir tabloyu göremez.)
do $$
declare t text;
  data_tables text[] := array[
    'accounts','accountEntries','dayEndRecords','currentMovements',
    'bankTransactions','cashflowItems','settings','auditLog'
  ];
begin
  foreach t in array data_tables loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists p_auth_all      on public.%I;', t);
    execute format('drop policy if exists p_approved_all   on public.%I;', t);
    execute format(
      'create policy p_approved_all on public.%I
         for all to authenticated
         using (public.is_approved())
         with check (public.is_approved());', t);
  end loop;
end $$;

-- 4) users tablosu: herkes YALNIZ KENDİ satırını yönetir; onaylılar hepsini
alter table public.users enable row level security;
drop policy if exists p_auth_all    on public.users;
drop policy if exists p_users_self  on public.users;
create policy p_users_self on public.users
  for all to authenticated
  using ( id = auth.uid()::text or public.is_approved() )
  with check ( id = auth.uid()::text or public.is_approved() );

-- =====================================================================
-- 5) İLK ADMIN(LER)İ ONAYLA  —  ⚠️ BU ADIMI YAPMAZSAN SEN DE GİREMEZSİN!
--    Supabase panel → Authentication → Users → kendi satırındaki "User UID"i
--    kopyala, aşağıya yapıştır ve bu satırı çalıştır:
--
--    insert into public.approved_users (uid, email)
--    values ('BURAYA-KENDI-UID', 'nizamsoft@icloud.com')
--    on conflict (uid) do nothing;
--
--    Her yeni personel için: önce uygulamadan "Kayıt Ol" desin, sonra sen
--    onun UID'ini yukarıdaki gibi approved_users'a ekle. Eklemezsen giremez.
-- =====================================================================

-- 6) (Öneri) Ekstra kilit — Supabase panelinden yap:
--    • Authentication → Sign In / Providers → "Allow new users to sign up"
--      KAPAT (personeli sen Users ekranından ekle) → istenmeyen kayıt olmaz.
--    • Authentication → Email → "Confirm email" AÇIK.
--    • Settings → API → sadece gerekli tabloların Exposed olduğundan emin ol.
