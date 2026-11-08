-- =====================================================================
--  نظام إدارة مخزون رواد الاعتماد — قاعدة بيانات Supabase
--  شغّل هذا الملف مرة واحدة من: Supabase Dashboard ← SQL Editor ← New query
--  الملف آمن لإعادة التشغيل (idempotent).
-- =====================================================================

-- ---------- الموظفون والصلاحيات ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'staff' check (role in ('admin', 'staff')),
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- أول مستخدم يُسجَّل يصبح مديرًا مفعّلًا، وكل من بعده يُنشأ "غير مفعّل" حتى يفعّله المدير
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  is_first boolean;
begin
  perform pg_advisory_xact_lock(7461001);
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    case when is_first then 'admin' else 'staff' end,
    is_first
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- منع إلغاء آخر مدير مفعّل (حتى لا يُقفل النظام)
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles where id <> old.id and role = 'admin' and active) then
      raise exception 'لا يمكن إلغاء صلاحية آخر مدير في النظام';
    end if;
  end if;
  new.id := old.id;          -- لا يمكن تغيير المعرّف
  new.email := old.email;    -- البريد يأتي من نظام الدخول
  return new;
end;
$$;

drop trigger if exists profiles_keep_admin on public.profiles;
create trigger profiles_keep_admin
  before update on public.profiles
  for each row execute function public.keep_one_admin();

alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active_user());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- جداول البيانات ----------
-- كل سجل محفوظ كـ JSON في عمود data، مع أعمدة تدقيق يملؤها الخادم
do $$
declare t text;
begin
  foreach t in array array['cars', 'suppliers', 'expenses', 'sales', 'movements'] loop
    execute format($f$
      create table if not exists public.%1$I (
        id          text primary key,
        data        jsonb not null,
        created_by  uuid default auth.uid() references auth.users (id) on delete set null,
        created_at  timestamptz not null default now(),
        updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
        updated_at  timestamptz not null default now()
      )$f$, t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

create table if not exists public.app_settings (
  id          int primary key default 1 check (id = 1),
  data        jsonb not null default '{}'::jsonb,
  updated_by  uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;

-- ختم التعديل: من عدّل ومتى (لا يمكن تزويره من المتصفح)
create or replace function public.stamp_row() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' and tg_table_name <> 'app_settings' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if tg_op = 'INSERT' and tg_table_name <> 'app_settings' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['cars', 'suppliers', 'expenses', 'sales', 'movements', 'app_settings'] loop
    execute format('drop trigger if exists stamp on public.%I', t);
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.stamp_row()', t);
  end loop;
end $$;

-- ---------- قيود سلامة البيانات ----------
create unique index if not exists cars_stock_no_key on public.cars ((data ->> 'stockNo'));
create unique index if not exists cars_vin_key on public.cars ((data ->> 'vin')) where coalesce(data ->> 'vin', '') <> '';
create unique index if not exists sales_car_key on public.sales ((data ->> 'carId'));        -- السيارة لا تُباع مرتين
create unique index if not exists sales_invoice_key on public.sales ((data ->> 'invoiceNo'));
create index if not exists movements_created_at_idx on public.movements (created_at desc);

-- ---------- الصلاحيات (Row Level Security) ----------
-- الموظف المفعّل: يقرأ ويضيف ويعدّل. الحذف للمدير فقط. سجل الحركات لا يُعدَّل ولا يُحذف.
do $$
declare t text;
begin
  foreach t in array array['cars', 'suppliers', 'expenses', 'sales'] loop
    execute format('drop policy if exists %1$s_select on public.%1$I', t);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (public.is_active_user())', t);
    execute format('drop policy if exists %1$s_insert on public.%1$I', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.is_active_user())', t);
    execute format('drop policy if exists %1$s_update on public.%1$I', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (public.is_active_user()) with check (public.is_active_user())', t);
    execute format('drop policy if exists %1$s_delete on public.%1$I', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (public.is_admin())', t);
  end loop;
end $$;

drop policy if exists movements_select on public.movements;
create policy movements_select on public.movements for select to authenticated using (public.is_active_user());
drop policy if exists movements_insert on public.movements;
create policy movements_insert on public.movements for insert to authenticated with check (public.is_active_user());

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.is_active_user());
drop policy if exists settings_insert on public.app_settings;
create policy settings_insert on public.app_settings for insert to authenticated with check (public.is_admin());
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.cars, public.suppliers, public.expenses, public.sales to authenticated;
grant select, insert on public.movements to authenticated;
grant select, insert, update on public.app_settings to authenticated;
revoke all on public.profiles, public.cars, public.suppliers, public.expenses, public.sales, public.movements, public.app_settings from anon;

-- ---------- الترقيم التلقائي (آمن مع عدة مستخدمين في نفس الوقت) ----------
create sequence if not exists public.stock_no_seq start 1001;
create sequence if not exists public.invoice_no_seq start 1;

create or replace function public.next_stock_no() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'غير مصرح'; end if;
  return 'RW-' || nextval('public.stock_no_seq');
end;
$$;

create or replace function public.next_invoice_no() returns text
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_active_user() then raise exception 'غير مصرح'; end if;
  return 'INV-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(nextval('public.invoice_no_seq')::text, 4, '0');
end;
$$;

-- يضبط العدادات على أعلى رقم موجود (بعد الاستيراد أو البيانات التجريبية)
create or replace function public.sync_counters() returns void
language plpgsql security definer set search_path = public as $$
declare s bigint; i bigint;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select coalesce(max(((regexp_match(data ->> 'stockNo', '(\d+)$'))[1])::bigint), 1000) into s from public.cars;
  select coalesce(max(((regexp_match(data ->> 'invoiceNo', '(\d+)$'))[1])::bigint), 0) into i from public.sales;
  perform setval('public.stock_no_seq', greatest(s, 1000));
  if i > 0 then perform setval('public.invoice_no_seq', i); else perform setval('public.invoice_no_seq', 1, false); end if;
end;
$$;

-- مسح كل بيانات المخزون (للمدير فقط) مع الإبقاء على الموظفين والإعدادات
create or replace function public.wipe_inventory() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  delete from public.movements where true;
  delete from public.sales where true;
  delete from public.expenses where true;
  delete from public.cars where true;
  delete from public.suppliers where true;
  perform setval('public.stock_no_seq', 1000);
  perform setval('public.invoice_no_seq', 1, false);
end;
$$;

revoke execute on function public.next_stock_no(), public.next_invoice_no(), public.sync_counters(), public.wipe_inventory() from public, anon;
grant execute on function public.next_stock_no(), public.next_invoice_no(), public.sync_counters(), public.wipe_inventory(), public.is_admin(), public.is_active_user() to authenticated;

-- ---------- التحديث اللحظي بين الأجهزة ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['cars', 'suppliers', 'expenses', 'sales', 'movements', 'app_settings', 'profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
