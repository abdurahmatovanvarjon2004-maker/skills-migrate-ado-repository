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
  created_at   timestamptz default now(),
  called_at    timestamptz,
  done_at      timestamptz
);
create index if not exists tickets_branch_status_idx on public.tickets(branch_id, status, priority desc, created_at);

-- ============================================================
--  RPC FUNKSIYALAR
-- ============================================================
create or replace function public.take_ticket(p_service uuid, p_name text default '', p_priority int default 0)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare v_service services; v_num int; v_ticket tickets;
begin
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

create or replace function public.call_next(p_branch uuid, p_window int)
returns public.tickets language plpgsql security definer set search_path = public as $$
declare v_ticket tickets;
begin
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
declare v_ticket tickets;
begin
  update tickets set status='done', done_at=now()
    where branch_id=(select branch_id from tickets where id=p_ticket)
      and status='serving' and window_no=p_window;
  update tickets set status='serving', window_no=p_window, called_at=now()
    where id=p_ticket returning * into v_ticket;
  return v_ticket;
end $$;

create or replace function public.finish_ticket(p_ticket uuid)
returns void language sql security definer set search_path = public as $$
  update tickets set status='done', done_at=now() where id=p_ticket;
$$;

create or replace function public.cancel_ticket(p_ticket uuid)
returns void language sql security definer set search_path = public as $$
  update tickets set status='cancelled' where id=p_ticket and status in ('waiting');
$$;

create or replace function public.noshow_ticket(p_ticket uuid)
returns void language sql security definer set search_path = public as $$
  update tickets set status='no_show', done_at=now() where id=p_ticket;
$$;

-- ============================================================
--  RLS
-- ============================================================
alter table public.branches enable row level security;
alter table public.services enable row level security;
alter table public.windows  enable row level security;
alter table public.tickets  enable row level security;
create policy "read branches" on public.branches for select using (true);
create policy "read services" on public.services for select using (true);
create policy "read windows"  on public.windows  for select using (true);
create policy "read tickets"  on public.tickets  for select using (true);

-- ============================================================
--  REALTIME
-- ============================================================
alter publication supabase_realtime add table public.tickets;
alter publication supabase_realtime add table public.services;

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
