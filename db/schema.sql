-- ============================================================
--  NAVBATSIZ — universal (ko'p-tarmoqli) ma'lumotlar bazasi
--  Isbot: bitta tizim — istalgan soha (klinika, bank, davlat
--  xizmati, salon, avtoservis...) uchun KOD O'ZGARTIRMASDAN.
--  Supabase -> SQL Editor -> to'liq joylang -> Run
-- ============================================================

-- ---------- 1. MUASSASALAR (har qanday soha) ----------
create table if not exists public.branches (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  place        text default '',
  slug         text unique not null,
  industry     text default 'other',   -- clinic | bank | government | salon | auto | telecom | other
  ticket_word  text default 'Navbat',   -- "Navbat" / "Talon"
  window_word  text default 'Oyna',     -- "Kassa" / "Deraza" / "Stol" / "Post" / "Usta"
  brand_color  text default '#34F5C5',
  logo_url     text default '',
  active       boolean default true,
  created_at   timestamptz default now()
);

-- ---------- 2. XIZMATLAR ----------
create table if not exists public.services (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  code         text not null,
  name         text not null,
  hint         text default '',
  sort         int  default 0,
  counter      int  default 0,
  active       boolean default true,
  unique (branch_id, code)
);

-- ---------- 3. OYNALAR / STOLLAR ----------
create table if not exists public.windows (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  no           int  not null,
  label        text default '',
  active       boolean default true,
  unique (branch_id, no)
);

-- ---------- 4. NAVBAT TALONLARI ----------
create table if not exists public.tickets (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  service_id   uuid not null references public.services(id) on delete cascade,
  tag          text not null,
  name         text default '',
  status       text not null default 'waiting',  -- waiting|serving|done|cancelled|no_show
  window_no    int,
  priority     int  default 0,         -- 0=oddiy, 1=imtiyozli
  access_token uuid default gen_random_uuid(),  -- mijoz o'z taloniga shu orqali kiradi (login'siz)
  created_at   timestamptz default now(),
  called_at    timestamptz,
  done_at      timestamptz
);
create index if not exists tickets_branch_status_idx on public.tickets(branch_id, status, priority desc, created_at);
-- Eski (access_token'siz) o'rnatilgan bazalar uchun xavfsiz migratsiya:
alter table public.tickets add column if not exists access_token uuid default gen_random_uuid();
update public.tickets set access_token = gen_random_uuid() where access_token is null;

-- ---------- 5. XODIMLAR (auth.uid() -> filial bog'lanishi) ----------
-- Qatorlar Supabase dashboard/SQL orqali qo'lda kiritiladi: xodim
-- Authentication -> Users'da yaratilgach, uning user_id'si shu yerga
-- tegishli branch_id bilan qo'shiladi.
-- role: 'admin' = filial sozlamalarini tahrirlaydi; 'operator' = faqat navbat.
create table if not exists public.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  branch_id    uuid not null references public.branches(id) on delete cascade,
  role         text not null default 'operator',   -- 'admin' | 'operator'
  created_at   timestamptz default now()
);
-- Eski o'rnatilgan bazalar uchun xavfsiz migratsiya:
alter table public.staff add column if not exists role text not null default 'operator';

-- ---------- 6. PLATFORMA ADMINLARI (yangi kompaniya ocha oladi) ----------
-- Birinchi admin QO'LDA kiritiladi (docs/ONBOARDING.md'ga qarang):
--   insert into platform_admins(user_id) values ('<sizning-auth-user-id>');
create table if not exists public.platform_admins (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  created_at   timestamptz default now()
);

-- Joriy (auth.uid() bo'yicha) tizimga kirgan xodimning filialini qaytaradi,
-- xodim bo'lmasa yoki login qilinmagan bo'lsa null.
create or replace function public.current_staff_branch()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.staff where user_id = auth.uid()
$$;

-- Joriy foydalanuvchi platforma admini (yangi kompaniya ocha oladi)?
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.platform_admins where user_id = auth.uid())
$$;

-- Joriy foydalanuvchi shu filialni boshqara oladi (platforma admini YOKI
-- shu filialning 'admin' xodimi)?
create or replace function public.can_manage_branch(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_platform_admin() or exists(
    select 1 from public.staff
    where user_id = auth.uid() and branch_id = p_branch and role = 'admin'
  )
$$;

-- ---------- take_ticket flood himoyasi ----------
-- So'rov manbasi (IP) bo'yicha oddiy throttling logi. Faqat talon
-- yaratilganda yoziladi, shu sabab jadval kichik bo'lib qoladi.
create table if not exists public.take_ticket_log (
  key        text not null,
  created_at timestamptz default now()
);
create index if not exists take_ticket_log_key_created_idx on public.take_ticket_log(key, created_at);
-- RLS yoqilgan, lekin SIYOSAT YO'Q — hech kim (anon/authenticated) shu
-- jadvalni to'g'ridan-to'g'ri o'qiy/yoza olmaydi (aks holda o'z IP
-- qatorlarini o'chirib, throttling'ni chetlab o'tishi mumkin edi).
-- Faqat take_ticket() (SECURITY DEFINER, jadval egasi nomidan RLS'ni
-- chetlab o'tadi) yoza/o'qiy oladi.
alter table public.take_ticket_log enable row level security;

-- ============================================================
--  RPC FUNKSIYALAR
-- ============================================================
create or replace function public.take_ticket(p_service uuid, p_name text default '', p_priority int default 0)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare
  v_service services; v_num int; v_ticket tickets;
  v_key text; v_recent int;
  c_limit constant int := 5;               -- 1 daqiqada shu manbadan ruxsat etilgan eng ko'p talon
  c_window constant interval := interval '1 minute';
begin
  -- IP manzilini PostgREST so'rov header'idan olamiz (Supabase har bir
  -- so'rovda shuni uzatadi). Header topilmasa (masalan SQL Editor'dan
  -- to'g'ridan-to'g'ri chaqirilganda) 'unknown'ga tushamiz — funksiya
  -- buzilmasligi uchun.
  begin
    v_key := nullif(trim(split_part(
      current_setting('request.headers', true)::json ->> 'x-forwarded-for', ',', 1)), '');
  exception when others then
    v_key := null;
  end;
  v_key := coalesce(v_key, 'unknown');

  select count(*) into v_recent from take_ticket_log
    where key = v_key and created_at > now() - c_window;
  if v_recent >= c_limit then
    raise exception 'rate_limited';
  end if;
  insert into take_ticket_log(key) values (v_key);

  select * into v_service from services where id = p_service and active for update;
  if not found then raise exception 'service_not_found'; end if;
  v_num := v_service.counter + 1;
  update services set counter = v_num where id = p_service;
  insert into tickets(branch_id, service_id, tag, name, status, priority)
  values (v_service.branch_id, v_service.id,
          v_service.code || '-' || lpad(v_num::text, 3, '0'),
          coalesce(nullif(trim(p_name), ''), ''), 'waiting', greatest(0, p_priority))
  returning * into v_ticket;
  return v_ticket;
end $$;

-- Quyidagi call_next/call_ticket/finish_ticket/noshow_ticket faqat shu
-- filialga biriktirilgan (staff jadvalidagi) login qilgan xodim uchun
-- ishlaydi — SECURITY DEFINER bo'lgani uchun RLS'ni chetlab o'tadi, shu
-- sabab tekshiruv funksiya ICHIDA amalga oshiriladi.
create or replace function public.call_next(p_branch uuid, p_window int)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare v_ticket tickets;
begin
  if p_branch is distinct from current_staff_branch() then raise exception 'not_authorized'; end if;
  update tickets set status='done', done_at=now()
    where branch_id=p_branch and status='serving' and window_no=p_window;
  select * into v_ticket from tickets
    where branch_id=p_branch and status='waiting'
    order by priority desc, created_at asc limit 1 for update skip locked;
  if not found then return null; end if;
  update tickets set status='serving', window_no=p_window, called_at=now()
    where id=v_ticket.id returning * into v_ticket;
  return v_ticket;
end $$;

create or replace function public.call_ticket(p_ticket uuid, p_window int)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare v_ticket tickets; v_branch uuid;
begin
  select branch_id into v_branch from tickets where id=p_ticket;
  if v_branch is null then raise exception 'ticket_not_found'; end if;
  if v_branch is distinct from current_staff_branch() then raise exception 'not_authorized'; end if;
  update tickets set status='done', done_at=now()
    where branch_id=v_branch and status='serving' and window_no=p_window;
  update tickets set status='serving', window_no=p_window, called_at=now()
    where id=p_ticket returning * into v_ticket;
  return v_ticket;
end $$;

create or replace function public.finish_ticket(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from tickets where id=p_ticket;
  if v_branch is null or v_branch is distinct from current_staff_branch() then raise exception 'not_authorized'; end if;
  update tickets set status='done', done_at=now() where id=p_ticket;
end $$;

-- cancel_ticket ikkala tomon uchun ham ishlaydi: filial xodimi (o'z
-- filiali talonini) YOKI mijozning o'zi (p_token — o'z access_token'i
-- bilan, login qilmasdan) bekor qila oladi.
-- Eski bir-argumentli (p_token'siz, tekshiruvsiz) versiyani olib
-- tashlaymiz — aks holda "create or replace" uni almashtirmay, yonma-yon
-- ikkinchi (himoyasiz) overload sifatida qoldirib ketardi.
drop function if exists public.cancel_ticket(uuid);
create or replace function public.cancel_ticket(p_ticket uuid, p_token uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_branch uuid; v_token uuid;
begin
  select branch_id, access_token into v_branch, v_token from tickets where id=p_ticket;
  if v_branch is null then raise exception 'ticket_not_found'; end if;
  if v_branch is distinct from current_staff_branch()
     and (p_token is null or p_token is distinct from v_token) then
    raise exception 'not_authorized';
  end if;
  update tickets set status='cancelled' where id=p_ticket and status in ('waiting');
end $$;

create or replace function public.noshow_ticket(p_ticket uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_branch uuid;
begin
  select branch_id into v_branch from tickets where id=p_ticket;
  if v_branch is null or v_branch is distinct from current_staff_branch() then raise exception 'not_authorized'; end if;
  update tickets set status='no_show', done_at=now() where id=p_ticket;
end $$;

-- ---------- Ommaviy o'qish (login talab qilmaydi, PII'siz) ----------
-- TV-tablo va mijozning "oldimda nechta kishi" ko'rinishi shundan
-- foydalanadi — ism (name) MAYDONI QAYTARILMAYDI.
create or replace function public.get_queue_public(p_branch uuid)
returns table(id uuid, tag text, status text, window_no int, priority int, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select id, tag, status, window_no, priority, created_at
  from public.tickets
  where branch_id = p_branch and status in ('waiting','serving')
  order by priority desc, created_at asc
$$;

-- Mijoz o'z taloniga (ism bilan — bu o'ziniki) login qilmasdan, faqat
-- olgan access_token'i orqali kira oladi. Boshqa talonlarni ko'ra olmaydi.
-- "setof" — token mos kelmasa NOL qator qaytadi (bitta NULL to'lgan
-- qator emas, aks holda mijoz tarafda "talon topildi" deb noto'g'ri
-- talqin qilinishi mumkin edi).
create or replace function public.get_ticket_by_token(p_token uuid)
returns setof public.tickets
language sql stable security definer set search_path = public as $$
  select * from public.tickets where access_token = p_token
$$;

-- ============================================================
--  KOMPANIYA BOSHQARUVI (onboarding + sozlamalar)
--  Barcha yozuvlar SECURITY DEFINER RPC orqali — jadvalga to'g'ridan-
--  to'g'ri INSERT/UPDATE ochilmaydi; ruxsat funksiya ichida tekshiriladi.
-- ============================================================

-- Yangi kompaniya (filial) yaratish — FAQAT platforma admini.
create or replace function public.create_branch(
  p_name text, p_slug text, p_place text default '', p_industry text default 'other',
  p_ticket_word text default 'Navbat', p_window_word text default 'Oyna',
  p_brand_color text default '', p_logo_url text default ''
) returns public.branches language plpgsql security definer set search_path = public as $$
declare v_branch branches;
begin
  if not is_platform_admin() then raise exception 'not_authorized'; end if;
  if coalesce(trim(p_name),'')='' or coalesce(trim(p_slug),'')='' then raise exception 'name_and_slug_required'; end if;
  insert into branches(name, slug, place, industry, ticket_word, window_word, brand_color, logo_url)
  values (trim(p_name), lower(trim(p_slug)), coalesce(p_place,''), coalesce(nullif(trim(p_industry),''),'other'),
          coalesce(nullif(trim(p_ticket_word),''),'Navbat'), coalesce(nullif(trim(p_window_word),''),'Oyna'),
          nullif(trim(p_brand_color),''), nullif(trim(p_logo_url),''))
  returning * into v_branch;
  return v_branch;
end $$;

-- Xizmat qo'shish/yangilash — filial admini yoki platforma admini.
create or replace function public.upsert_service(
  p_branch uuid, p_code text, p_name text, p_hint text default '', p_sort int default 0, p_active boolean default true
) returns public.services language plpgsql security definer set search_path = public as $$
declare v_service services;
begin
  if not can_manage_branch(p_branch) then raise exception 'not_authorized'; end if;
  insert into services(branch_id, code, name, hint, sort, active)
  values (p_branch, upper(trim(p_code)), trim(p_name), coalesce(p_hint,''), coalesce(p_sort,0), coalesce(p_active,true))
  on conflict (branch_id, code) do update
    set name=excluded.name, hint=excluded.hint, sort=excluded.sort, active=excluded.active
  returning * into v_service;
  return v_service;
end $$;

-- Oyna/stol qo'shish/yangilash — filial admini yoki platforma admini.
create or replace function public.upsert_window(
  p_branch uuid, p_no int, p_label text default '', p_active boolean default true
) returns public.windows language plpgsql security definer set search_path = public as $$
declare v_win windows;
begin
  if not can_manage_branch(p_branch) then raise exception 'not_authorized'; end if;
  insert into windows(branch_id, no, label, active)
  values (p_branch, p_no, coalesce(p_label,''), coalesce(p_active,true))
  on conflict (branch_id, no) do update set label=excluded.label, active=excluded.active
  returning * into v_win;
  return v_win;
end $$;

-- Filial sozlamalari/brendini yangilash — filial admini yoki platforma admini.
create or replace function public.update_branch_settings(
  p_branch uuid, p_name text, p_place text, p_ticket_word text, p_window_word text,
  p_brand_color text default '', p_logo_url text default '', p_active boolean default true
) returns public.branches language plpgsql security definer set search_path = public as $$
declare v_branch branches;
begin
  if not can_manage_branch(p_branch) then raise exception 'not_authorized'; end if;
  update branches set
    name = coalesce(nullif(trim(p_name),''), name),
    place = coalesce(p_place, place),
    ticket_word = coalesce(nullif(trim(p_ticket_word),''), ticket_word),
    window_word = coalesce(nullif(trim(p_window_word),''), window_word),
    brand_color = nullif(trim(p_brand_color),''),
    logo_url = nullif(trim(p_logo_url),''),
    active = coalesce(p_active, active)
  where id = p_branch returning * into v_branch;
  return v_branch;
end $$;

-- Xodimni filialga biriktirish (auth user oldindan yaratilgan bo'lishi kerak).
-- Filial admini yoki platforma admini.
create or replace function public.assign_staff(p_user uuid, p_branch uuid, p_role text default 'operator')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_branch(p_branch) then raise exception 'not_authorized'; end if;
  insert into staff(user_id, branch_id, role)
  values (p_user, p_branch, coalesce(nullif(trim(p_role),''),'operator'))
  on conflict (user_id) do update set branch_id=excluded.branch_id, role=excluded.role;
end $$;

-- Joriy foydalanuvchi haqida qisqa ma'lumot (panel/admin UI uchun):
-- platforma admini ekanmi, qaysi filial, qanday rol.
create or replace function public.my_context()
returns table(is_admin boolean, branch_id uuid, role text)
language sql stable security definer set search_path = public as $$
  select public.is_platform_admin(),
         (select branch_id from staff where user_id = auth.uid()),
         (select role from staff where user_id = auth.uid())
$$;

-- ============================================================
--  RLS
-- ============================================================
alter table public.branches enable row level security;
alter table public.services enable row level security;
alter table public.windows  enable row level security;
alter table public.tickets  enable row level security;
alter table public.staff    enable row level security;
alter table public.platform_admins enable row level security;
-- platform_admins'ga siyosat yo'q — faqat security definer funksiyalar
-- (is_platform_admin) o'qiydi; hech kim to'g'ridan-to'g'ri o'qiy/yoza olmaydi.

-- branches/services/windows'da shaxsiy ma'lumot yo'q (filial nomi,
-- xizmat nomi, oyna raqami) — ommaviy o'qish xavfsiz, o'zgarishsiz qoladi.
drop policy if exists "read branches" on public.branches;
drop policy if exists "read services" on public.services;
drop policy if exists "read windows"  on public.windows;
create policy "read branches" on public.branches for select using (true);
create policy "read services" on public.services for select using (true);
create policy "read windows"  on public.windows  for select using (true);

-- Xodim faqat o'zining staff qatorini ko'radi (qaysi filialga tegishli
-- ekanini aniqlash uchun).
drop policy if exists "staff read own row" on public.staff;
create policy "staff read own row" on public.staff for select
  using (user_id = auth.uid());

-- ESKI "read tickets" using(true) siyosati o'chirildi — u BARCHA
-- filiallarning BARCHA talonlarini, MIJOZ ISMI bilan birga, hammaga
-- ochiq qilardi. O'rniga: faqat login qilgan xodim, faqat O'Z filiali
-- talonlarini to'g'ridan-to'g'ri jadvaldan o'qiy oladi. Anon/mijoz uchun
-- to'g'ridan-to'g'ri SELECT siyosati YO'Q — ular yuqoridagi
-- get_queue_public() / get_ticket_by_token() RPC'lari orqali, faqat
-- kerakli (PII'siz yoki o'ziniki) ma'lumotni oladi.
drop policy if exists "read tickets" on public.tickets;
drop policy if exists "staff read own branch tickets" on public.tickets;
create policy "staff read own branch tickets" on public.tickets for select
  to authenticated
  using (branch_id = current_staff_branch());

-- Mutatsion RPC'lar SECURITY DEFINER bo'lgani uchun RLS'dan mustaqil
-- ishlaydi (tekshiruv funksiya ichida) — shunga qaramay, qo'shimcha
-- himoya sifatida EXECUTE huquqini ham rollarga aniq taqsimlaymiz.
-- Avval hammasini tozalaymiz (Supabase loyihasi standart qanday
-- sozlangan bo'lishidan qat'iy nazar natija bashorat qilinadigan
-- bo'lishi uchun), so'ng faqat kerakli rolga qaytarib beramiz.
revoke execute on function public.call_next(uuid, int)         from public, anon, authenticated;
revoke execute on function public.call_ticket(uuid, int)       from public, anon, authenticated;
revoke execute on function public.finish_ticket(uuid)          from public, anon, authenticated;
revoke execute on function public.noshow_ticket(uuid)          from public, anon, authenticated;
revoke execute on function public.take_ticket(uuid, text, int) from public, anon, authenticated;
revoke execute on function public.cancel_ticket(uuid, uuid)    from public, anon, authenticated;
revoke execute on function public.get_queue_public(uuid)       from public, anon, authenticated;
revoke execute on function public.get_ticket_by_token(uuid)    from public, anon, authenticated;

-- Faqat login qilgan (o'z filialiga tegishli) xodim uchun:
grant execute on function public.call_next(uuid, int)   to authenticated;
grant execute on function public.call_ticket(uuid, int) to authenticated;
grant execute on function public.finish_ticket(uuid)    to authenticated;
grant execute on function public.noshow_ticket(uuid)    to authenticated;

-- Login talab qilmaydigan (mijoz, TV-tablo) amallar:
grant execute on function public.take_ticket(uuid, text, int) to anon, authenticated;
grant execute on function public.cancel_ticket(uuid, uuid)     to anon, authenticated;
grant execute on function public.get_queue_public(uuid)        to anon, authenticated;
grant execute on function public.get_ticket_by_token(uuid)     to anon, authenticated;

-- Kompaniya boshqaruvi RPC'lari — faqat login qilgan foydalanuvchi
-- (ruxsat funksiya ichida is_platform_admin/can_manage_branch bilan tekshiriladi).
revoke execute on function public.create_branch(text,text,text,text,text,text,text,text) from public, anon, authenticated;
revoke execute on function public.upsert_service(uuid,text,text,text,int,boolean)         from public, anon, authenticated;
revoke execute on function public.upsert_window(uuid,int,text,boolean)                    from public, anon, authenticated;
revoke execute on function public.update_branch_settings(uuid,text,text,text,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.assign_staff(uuid,uuid,text)                            from public, anon, authenticated;
grant execute on function public.create_branch(text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.upsert_service(uuid,text,text,text,int,boolean)         to authenticated;
grant execute on function public.upsert_window(uuid,int,text,boolean)                    to authenticated;
grant execute on function public.update_branch_settings(uuid,text,text,text,text,text,text,boolean) to authenticated;
grant execute on function public.assign_staff(uuid,uuid,text)                            to authenticated;
grant execute on function public.my_context()                                            to authenticated;
grant execute on function public.is_platform_admin()                                     to authenticated;
grant execute on function public.can_manage_branch(uuid)                                 to authenticated;

-- ============================================================
--  REALTIME
-- ============================================================
-- Idempotent: jadval allaqachon publikatsiyada bo'lsa xato bermaydi
-- (schema.sql'ni qayta ishga tushirish xavfsiz bo'lishi uchun).
do $$
declare t text;
begin
  foreach t in array array['tickets','services','windows'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================
--  ISBOT: 4 XIL SOHA — bir xil tizim, turli sozlama
-- ============================================================
insert into public.branches (name, place, slug, industry, ticket_word, window_word) values
  ('Shifo klinikasi',        '1-qavat, qabulxona', 'shifo-klinika',  'clinic',     'Navbat', 'Kassa'),
  ('Milliy bank - Chilonzor','Operatsion zal',     'bank-chilonzor', 'bank',       'Talon',  'Deraza'),
  ('Davlat xizmatlari markazi','2-qavat',          'dxm-yunusobod',  'government', 'Navbat', 'Stol'),
  ('Style barbershop',       'Asosiy zal',         'style-barber',   'salon',      'Navbat', 'Usta')
on conflict (slug) do nothing;

insert into public.services (branch_id, code, name, hint, sort)
select b.id, v.code, v.name, v.hint, v.sort from public.branches b,
 (values ('A','Terapevt qabuli','Shifokor korigi',1),
         ('B','Tahlil / laboratoriya','Qon, tahlillar',2),
         ('C','Kassa / tolov','Tolov',3)) v(code,name,hint,sort)
where b.slug='shifo-klinika' on conflict do nothing;

insert into public.services (branch_id, code, name, hint, sort)
select b.id, v.code, v.name, v.hint, v.sort from public.branches b,
 (values ('A','Omonat / karta','Hisob, plastik karta',1),
         ('B','Kredit','Kredit va tolovlar',2),
         ('C','Valyuta ayirboshlash','Konvertatsiya',3),
         ('D','Yuridik shaxslar','Biznes mijozlar',4)) v(code,name,hint,sort)
where b.slug='bank-chilonzor' on conflict do nothing;

insert into public.services (branch_id, code, name, hint, sort)
select b.id, v.code, v.name, v.hint, v.sort from public.branches b,
 (values ('A','Pasport / ID','Hujjatlar',1),
         ('B','Kadastr / kochmas mulk','Royxatdan otkazish',2),
         ('C','Nikoh / FHDYo','Fuqarolik holati',3),
         ('D','Notarius','Tasdiqlash',4)) v(code,name,hint,sort)
where b.slug='dxm-yunusobod' on conflict do nothing;

insert into public.services (branch_id, code, name, hint, sort)
select b.id, v.code, v.name, v.hint, v.sort from public.branches b,
 (values ('A','Soch olish','Erkaklar',1),
         ('B','Soqol / parvarish','Beard care',2),
         ('C','Bolalar','Bolalar sartaroshligi',3)) v(code,name,hint,sort)
where b.slug='style-barber' on conflict do nothing;
