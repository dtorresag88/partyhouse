-- Party House — reservas pagadas con Mercado Pago
-- Solo la Edge Function (service role) accede a esta tabla: contiene datos personales.
create table public.reservas (
  id                uuid primary key default gen_random_uuid(),
  codigo            text not null unique,
  creada            timestamptz not null default now(),
  actualizada       timestamptz not null default now(),
  estado            text not null default 'pendiente'
                    check (estado in ('pendiente','pagado','rechazado','reembolsado','cancelado')),
  items             jsonb not null,          -- [{id, nombre, qty, fecha, precio}]
  fechas            date[] not null default '{}',
  total             integer not null check (total > 0),
  abono             integer not null check (abono > 0),
  cliente_nombre    text not null,
  cliente_telefono  text not null,
  cliente_email     text not null,
  comuna            text not null,
  notas             text,
  mp_preference_id  text,
  mp_payment_id     text,
  mp_status         text,
  mp_status_detail  text,
  monto_pagado      integer,
  pagada_en         timestamptz
);

create index reservas_estado_fechas_idx on public.reservas using gin (fechas) where estado = 'pagado';
create index reservas_creada_idx on public.reservas (creada desc);

alter table public.reservas enable row level security;
-- Sin políticas: anon y authenticated no pueden leer ni escribir. Solo service_role.
revoke all on public.reservas from anon, authenticated;

-- Configuración privada (ej. email_avisos: correo que recibe el aviso de cada abono pagado).
-- El valor se carga directo en la base, no en el repositorio.
create table public.config (
  clave text primary key,
  valor text not null
);
alter table public.config enable row level security;
revoke all on public.config from anon, authenticated;
alter table public.reservas add column aviso_enviado_en timestamptz;
alter table public.reservas add column confirmacion_cliente_en timestamptz;
