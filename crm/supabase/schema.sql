-- =====================================================================
--  نظام إدارة العملاء (CRM) — معرض رواد الاعتماد — قاعدة بيانات Supabase
--  شغّل هذا الملف مرة واحدة من: Supabase Dashboard ← SQL Editor ← New query
--  الملف آمن لإعادة التشغيل (idempotent).
--  يُفضّل مشروع Supabase مستقل لهذا النظام (منفصل عن نظام المخزون).
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
-- leads = العملاء ، activities = سجل التواصل (مكالمات، واتساب، تغيير مراحل)
do $$
declare t text;
begin
  foreach t in array array['leads', 'activities'] loop
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
  foreach t in array array['leads', 'activities', 'app_settings'] loop
    execute format('drop trigger if exists stamp on public.%I', t);
    execute format('create trigger stamp before insert or update on public.%I for each row execute function public.stamp_row()', t);
  end loop;
end $$;

create index if not exists leads_phone_idx on public.leads ((data ->> 'phone'));
create index if not exists activities_created_at_idx on public.activities (created_at desc);
create index if not exists activities_lead_idx on public.activities ((data ->> 'leadId'));

-- ---------- الصلاحيات (Row Level Security) ----------
-- الموظف المفعّل: يقرأ ويضيف ويعدّل العملاء. حذف العملاء للمدير فقط.
-- سجل التواصل لا يُعدَّل ولا يُحذف من أي موظف.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select to authenticated using (public.is_active_user());
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert to authenticated with check (public.is_active_user());
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update to authenticated using (public.is_active_user()) with check (public.is_active_user());
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (public.is_admin());

drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities for select to authenticated using (public.is_active_user());
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated with check (public.is_active_user());

drop policy if exists settings_select on public.app_settings;
create policy settings_select on public.app_settings for select to authenticated using (public.is_active_user());
drop policy if exists settings_insert on public.app_settings;
create policy settings_insert on public.app_settings for insert to authenticated with check (public.is_admin());
drop policy if exists settings_update on public.app_settings;
create policy settings_update on public.app_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert on public.activities to authenticated;
grant select, insert, update on public.app_settings to authenticated;
revoke all on public.profiles, public.leads, public.activities, public.app_settings from anon;

-- مسح كل العملاء وسجل التواصل (للمدير فقط) مع الإبقاء على الموظفين والإعدادات
create or replace function public.wipe_crm() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  delete from public.activities where true;
  delete from public.leads where true;
end;
$$;

revoke execute on function public.wipe_crm() from public, anon;
grant execute on function public.wipe_crm(), public.is_admin(), public.is_active_user() to authenticated;

-- ---------- التحديث اللحظي بين الأجهزة ----------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['leads', 'activities', 'app_settings', 'profiles'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;
