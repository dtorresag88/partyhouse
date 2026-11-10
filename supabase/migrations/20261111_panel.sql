-- =====================================================================
-- Party House · Panel de administración
-- Catálogo, flete, bloqueos y ajustes pasan a la base de datos (antes: archivos del sitio).
-- Equipo de administradores con invitaciones (mismo esquema que Planeta 4 Patas).
-- =====================================================================

-- ------------------------------------------------------------ equipo
create table if not exists public.admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  disabled_at timestamptz
);
create table if not exists public.admin_invites (
  email       text primary key,
  invited_by  text,
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at  timestamptz
);
alter table public.admins enable row level security;
alter table public.admin_invites enable row level security;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid() and a.disabled_at is null);
$$;

create policy "admins_self_read" on public.admins for select to authenticated
  using (user_id = auth.uid() or (select public.is_admin()));
create policy "invites_admin_read" on public.admin_invites for select to authenticated
  using ((select public.is_admin()));

create or replace function public.claim_admin_invite()
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_email text; v_confirmed timestamptz;
begin
  select lower(email), email_confirmed_at into v_email, v_confirmed from auth.users where id = auth.uid();
  if v_email is null or v_confirmed is null then return false; end if;
  if not exists (select 1 from public.admin_invites where email = v_email and accepted_at is null and revoked_at is null) then
    return public.is_admin();
  end if;
  insert into public.admins(user_id) values (auth.uid()) on conflict (user_id) do update set disabled_at = null;
  update public.admin_invites set accepted_at = now() where email = v_email;
  return true;
end; $$;

create or replace function public.admin_invite(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_uid uuid; v_actor text; v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Correo inválido'; end if;
  select email into v_actor from auth.users where id = auth.uid();
  select id into v_uid from auth.users where lower(email) = v_email and email_confirmed_at is not null;
  if v_uid is not null then
    insert into public.admins(user_id) values (v_uid) on conflict (user_id) do update set disabled_at = null;
    return 'added';
  end if;
  insert into public.admin_invites(email, invited_by) values (v_email, v_actor)
  on conflict (email) do update set accepted_at = null, revoked_at = null, invited_by = excluded.invited_by;
  return 'invited';
end; $$;

create or replace function public.admin_remove(p_email text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(trim(coalesce(p_email, ''))); v_uid uuid;
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  select id into v_uid from auth.users where lower(email) = v_email;
  if v_uid = auth.uid() then raise exception 'No puedes quitarte el acceso a ti mismo'; end if;
  update public.admin_invites set revoked_at = now() where email = v_email and accepted_at is null;
  if v_uid is not null then update public.admins set disabled_at = now() where user_id = v_uid and disabled_at is null; end if;
  return 'removed';
end; $$;

create or replace function public.admin_team()
returns table(user_id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, pending boolean)
language sql stable security definer set search_path = '' as $$
  select a.user_id, u.email::text, a.created_at, u.last_sign_in_at, false
    from public.admins a join auth.users u on u.id = a.user_id
   where a.disabled_at is null and public.is_admin()
  union all
  select null, i.email, i.created_at, null, true
    from public.admin_invites i
   where i.accepted_at is null and i.revoked_at is null and public.is_admin();
$$;

revoke execute on function public.admin_invite(text), public.admin_remove(text), public.admin_team() from public, anon;
grant execute on function public.admin_invite(text), public.admin_remove(text), public.admin_team(), public.claim_admin_invite() to authenticated;

-- ------------------------------------------------------------ ajustes generales (fila única)
create table if not exists public.ajustes (
  id                 int primary key default 1 check (id = 1),
  garantia_monto     int not null default 100000 check (garantia_monto >= 0),
  abono_pct          int not null default 50 check (abono_pct between 1 and 100),
  dias_anticipacion  int not null default 3 check (dias_anticipacion >= 0),
  meses_maximo       int not null default 4 check (meses_maximo between 1 and 24),
  recordatorio_dias  int not null default 7 check (recordatorio_dias between 1 and 30),
  updated_at         timestamptz not null default now()
);
insert into public.ajustes (id) values (1) on conflict do nothing;

-- ------------------------------------------------------------ catálogo
create table if not exists public.categorias (
  id      text primary key,
  nombre  text not null,
  icono   text not null default '✦',
  orden   int not null default 0,
  activa  boolean not null default true
);

create table if not exists public.productos (
  id                 text primary key,                    -- slug, aparece en producto.html?id=
  nombre             text not null,
  categoria          text not null references public.categorias(id) on update cascade,
  tamano             text not null default '',            -- "5 × 5 mts", "Pack LED"…
  capacidad          text not null default '',
  precio             int not null check (precio >= 0),
  precio_antes       int check (precio_antes is null or precio_antes > 0),
  tint               text not null default 'magenta',
  badges             text[] not null default '{}',
  imagenes           text[] not null default '{}',        -- URLs completas, la primera es la principal
  corto              text not null default '',
  largo              text not null default '',
  incluye            text[] not null default '{}',
  orden              int not null default 0,
  activo             boolean not null default true,
  bloqueo_automatico boolean not null default false,      -- 1 unidad: la fecha se bloquea al pagarse
  sin_flete          boolean not null default false,      -- ya incluye su transporte
  equipo             text,                                -- productos con el mismo equipo comparten unidad física
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists public.comunas (
  nombre  text primary key,
  valor   int not null check (valor >= 0),
  orden   int not null default 0,
  activa  boolean not null default true
);

-- Fechas bloqueadas a mano: producto null = día cerrado para todo el catálogo
create table if not exists public.bloqueos (
  id          bigint generated always as identity primary key,
  fecha       date not null,
  producto_id text references public.productos(id) on delete cascade on update cascade,
  motivo      text,
  creado_por  text,
  created_at  timestamptz not null default now()
);
create unique index if not exists bloqueos_unico on public.bloqueos (fecha, coalesce(producto_id, '*'));

alter table public.ajustes    enable row level security;
alter table public.categorias enable row level security;
alter table public.productos  enable row level security;
alter table public.comunas    enable row level security;
alter table public.bloqueos   enable row level security;

-- Lectura pública de lo que muestra el sitio; escritura solo administradores
create policy "ajustes_read"  on public.ajustes    for select using (true);
create policy "cat_read"      on public.categorias for select using (activa or (select public.is_admin()));
create policy "prod_read"     on public.productos  for select using (activo or (select public.is_admin()));
create policy "com_read"      on public.comunas    for select using (activa or (select public.is_admin()));
create policy "bloq_read"     on public.bloqueos   for select using (true);
create policy "ajustes_admin" on public.ajustes    for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "cat_admin"     on public.categorias for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "prod_admin"    on public.productos  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "com_admin"     on public.comunas    for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "bloq_admin"    on public.bloqueos   for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------ reservas: operación desde el panel
alter table public.reservas
  add column if not exists origen          text not null default 'web' check (origen in ('web','manual')),
  add column if not exists etapa           text not null default 'por_instalar'
                                            check (etapa in ('por_instalar','instalada','retirada')),
  add column if not exists abono_medio     text not null default 'mercadopago',
  add column if not exists saldo_pagado_en timestamptz,
  add column if not exists saldo_medio     text,
  add column if not exists descuento       int not null default 0 check (descuento >= 0),
  add column if not exists notas_internas  text,
  add column if not exists historial       jsonb not null default '[]';
alter table public.reservas alter column cliente_email drop not null;
grant select, update on public.reservas to authenticated;
create policy "reservas_admin_read" on public.reservas for select to authenticated using ((select public.is_admin()));
create policy "reservas_admin_upd"  on public.reservas for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ------------------------------------------------------------ fotos de productos
insert into storage.buckets (id, name, public) values ('productos', 'productos', true) on conflict (id) do nothing;
create policy "fotos_admin_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'productos' and (select public.is_admin()));
create policy "fotos_admin_update" on storage.objects for update to authenticated
  using (bucket_id = 'productos' and (select public.is_admin()));
create policy "fotos_admin_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'productos' and (select public.is_admin()));

-- La invitación del dueño se carga directo en la base (no se deja el correo en el repositorio).

-- Texto de categoría que muestra cada tarjeta (si difiere del nombre de la categoría)
alter table public.productos add column if not exists etiqueta text;
