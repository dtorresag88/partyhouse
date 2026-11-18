-- Party House · Carritos armados desde el panel
-- El administrador arma el pedido acordado por WhatsApp (productos, precios, fecha, flete) y le envía al cliente
-- un link (partyhouse.cl/pedido.html?c=TOKEN) donde completa sus datos y paga el abono con Mercado Pago.
-- El sitio no lee esta tabla: la función "pagos" la consulta con service role (rutas /carrito y /crear).

create table if not exists public.carritos (
  id               uuid primary key default gen_random_uuid(),
  token            text not null unique,
  estado           text not null default 'abierto' check (estado in ('abierto', 'pagado', 'anulado')),
  fecha            date not null,
  items            jsonb not null default '[]',          -- [{id, nombre, qty, precio, manual?}]
  comuna           text,                                 -- null: el cliente la elige y el flete sale de la tarifa
  flete            integer check (flete >= 0),           -- null: según la comuna
  descuento        integer not null default 0 check (descuento >= 0),
  cliente_nombre   text,
  cliente_telefono text,
  cliente_email    text,
  direccion        text,
  horario          text,
  mensaje          text,                                 -- nota visible para el cliente en la página
  notas_internas   text,                                 -- pasa a la reserva al pagar
  vence            date not null,
  creado           timestamptz not null default now(),
  creado_por       text,
  visto_en         timestamptz,
  reserva_codigo   text,                                 -- último intento de pago / reserva pagada
  pagado_en        timestamptz
);
create index if not exists carritos_creado_idx on public.carritos (creado desc);

alter table public.carritos enable row level security;
drop policy if exists carritos_admin on public.carritos;
create policy carritos_admin on public.carritos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Reserva creada desde un carrito
alter table public.reservas add column if not exists carrito_token text;
