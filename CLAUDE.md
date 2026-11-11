# Party House · Sitio y panel

Arriendo de carpas disco inflables, mobiliario LED, audio y juegos para fiestas (Santiago, Chile). WhatsApp +56 9 4902 2463 · Instagram @partyhouse_cl.

## Stack
- Sitio estático sin build en GitHub Pages (repo público dtorresag88/partyhouse, rama `main`, dominio partyhouse.cl).
- Backend: Supabase proyecto `uxhbzgkgiefjggxcapdq` (Postgres + Auth + Storage + Edge Function `pagos` con verify_jwt=false).
- Pagos: Mercado Pago Checkout Pro. Correos: Resend desde reservas@partyhouse.cl.

## Datos
- Catálogo, categorías, comunas (flete), bloqueos y ajustes viven en tablas (`productos`, `categorias`, `comunas`, `bloqueos`, `ajustes`).
- El sitio los carga con `<script src=".../functions/v1/pagos/datos.js">`, que define `window.PH_PRODUCTS`, `PH_CATEGORIES`, `PH_DISPONIBILIDAD`, `PH_TRANSPORTE`, `PH_AJUSTES` con el mismo formato que los antiguos `assets/data.js`, `disponibilidad.js`, `transporte.js` (que quedan solo como respaldo vía `document.write` si el script falla).
- El servidor (`crear`) recalcula precios, flete y abono desde la base. Nunca confiar en precios del cliente.
- `productos.equipo`: productos con el mismo equipo comparten unidad física. `bloqueo_automatico`: una unidad, la fecha se bloquea al confirmarse. `sin_flete`: ya incluye transporte.
- `reservas`: `estado` (pago: pendiente/pagado/rechazado/reembolsado/cancelado), `etapa` (por_instalar/instalada/retirada), `origen` (web/manual), garantía (`garantia_*`), `historial` jsonb, `items` jsonb [{id,nombre,qty,fecha,precio}]. Cada pedido es para un solo día.
- `config` (solo service role): `email_avisos` (correo del dueño, no va al repo) y `cron_key` (tarea diaria de recordatorios de garantía vía pg_cron + pg_net).

## Panel (`admin.html`)
- Basado en el panel de Planeta 4 Patas: `assets/admin/core.js` (utilidades, router hash, modales `A.modal/A.ask/A.confirm`, `A.setDirty`), `boot.js` (acceso, avisos en tiempo real, búsqueda), una sección por archivo (`inicio`, `reservas`, `calendario`, `productos`, `clientes`, `configuracion`). Todo cuelga de `window.A`.
- Admins: tablas `admins` / `admin_invites`, `is_admin()`, `claim_admin_invite()`, `admin_invite()`, `admin_remove()`, `admin_team()`. RLS: lectura pública de catálogo; escritura y reservas solo admins.
- Reserva manual: RPC `admin_crear_reserva(p jsonb)` (valida disponibilidad y equipo compartido; `forzar` la ignora).
- Confirmación por correo desde el panel: `POST pagos/confirmar` con el JWT del admin.
- Fotos: bucket público `productos`.

## Reglas de negocio
- Total = productos + flete − descuento; abono = `ajustes.abono_pct` % del total; saldo el día del evento.
- Garantía reembolsable (`ajustes.garantia_monto`): no se cobra al reservar; correo diario con link de MP desde `recordatorio_dias` antes del evento hasta que se pague.
- Botón de Mercado Pago visible solo con credenciales de producción (`pagos/modo`); con `?prueba=1` o en local se fuerza.

## Pruebas
- No hay usuario admin de prueba: probar el panel con Playwright y backend simulado (interceptar `/auth/v1`, `/rest/v1`, abortar `/realtime`). Probar a 375 px sin scroll horizontal.
- Para pagos reales de prueba no usar el checkout de MP con navegador automatizado (lo bloquea).

## Previsualizar en local
`python -m http.server 8765` y abrir http://127.0.0.1:8765 (el origen 127.0.0.1:8765 está permitido en CORS de la función).
