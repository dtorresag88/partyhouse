-- Party House · Cobro del saldo por link de Mercado Pago y dirección/horario del evento
alter table public.reservas
  add column if not exists direccion        text,
  add column if not exists horario          text,
  add column if not exists saldo_link       text,      -- link de pago del saldo (referencia "<codigo>-S")
  add column if not exists saldo_link_monto int,       -- monto con el que se generó el link
  add column if not exists saldo_payment_id text;

-- Reservas cargadas desde la planilla: "Dirección: X · Horario: Y" en notas → columnas propias
update public.reservas set
  direccion = nullif(trim(regexp_replace(substring(notas from 'Dirección: (.*?)( · Horario: |$)'), '\s+$', '')), ''),
  horario   = nullif(trim(substring(notas from 'Horario: (.*)$')), ''),
  notas     = null
where notas like 'Dirección: %';
