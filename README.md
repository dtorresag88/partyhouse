# Party House — Sitio web

Sitio estático de arriendo de carpas disco inflables, mobiliario LED, audio y juegos para fiestas. Santiago, Chile.

## Estructura

```
party-house-site/
├── index.html          # Home
├── catalogo.html       # Catálogo de productos
├── producto.html       # Ficha de producto (lee ?id= de la URL)
├── packs.html          # Packs / experiencias
├── carrito.html        # Carrito
├── checkout.html       # Reserva / checkout (deriva a WhatsApp)
├── contacto.html       # Contacto
├── faq.html            # Preguntas frecuentes
├── condiciones.html    # Condiciones del arriendo
└── assets/
    ├── site.css        # Estilos globales
    ├── data.js         # Catálogo de productos (datos)
    ├── partials.js     # Header / footer / chrome compartido
    ├── site.js         # Lógica (carrito, búsqueda, WhatsApp, etc.)
    ├── logo-white.png
    └── logo-dark.png
```

## Cómo correrlo

Es un sitio 100% estático. Para verlo localmente sirve la carpeta con cualquier servidor, por ejemplo:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

> Conviene servirlo (no abrir los `.html` directo con `file://`) para que los enlaces y scripts funcionen bien.

## Imágenes de producto

> **Importante:** las fichas de producto actualmente muestran **placeholders de color**. Los nombres de imagen en `assets/data.js` (campo `images`) vienen del export de Shopify pero los archivos **no están incluidos**.
>
> Para mostrar fotos reales: sube las imágenes a `assets/img/` (o tu CDN) y ajusta cómo se resuelven en `assets/site.js` (función `PH.photo`, que usa `p.img` / `opts.src`).

## WhatsApp

El número de contacto está en `assets/site.js` (`PH.waLink`, variable `phone`). Cámbialo ahí si corresponde.

## Disponibilidad de fechas (¡mantener al día!)

El calendario de cada producto, el carrito, el checkout y el planificador leen `assets/disponibilidad.js`.
Cada vez que confirmes una reserva, agrega la fecha (`'AAAA-MM-DD'`) bajo el id del producto en `ocupado`.
Para feriados o vacaciones usa `cerrado` (bloquea todo). Se puede editar directo en GitHub con el lápiz.
`comparten` agrupa productos que usan la misma carpa (ej. Party Cube 5×5 y Pack VIP 5×5).

## Arma tu fiesta (`arma-tu-fiesta.html`)

Planificador: el cliente elige tipo de celebración, invitados, nivel y fecha, y recibe un combo con total y abono
que puede agregar al carrito o cotizar por WhatsApp. Las reglas están en la función `recommend()` de esa página.
La sección "Completa tu fiesta" del carrito usa `PH.suggestFor()` en `assets/site.js`.

## Pago del abono con Mercado Pago

El checkout ofrece **"Pagar abono con Mercado Pago"** (Checkout Pro) además de reservar por WhatsApp.

- **Servidor:** Supabase, proyecto `partyhouse` (`uxhbzgkgiefjggxcapdq`), Edge Function `pagos`.
  Código en `supabase/functions/pagos/index.ts`; tabla `reservas` en `supabase/migrations/`.
- **Seguridad:** el servidor recalcula los precios leyendo `assets/data.js` del sitio publicado y valida las
  fechas con `assets/disponibilidad.js`, así que nadie puede pagar un monto adulterado. La tabla `reservas`
  no es accesible desde el navegador (solo la función).
- **Al pagarse un abono**, Mercado Pago avisa al webhook, la reserva queda `pagado` y la fecha se bloquea sola
  para los productos de `bloqueoAutomatico`. El cliente vuelve a `pago.html`, que muestra el comprobante.
- **Ver reservas:** Supabase → Table Editor → `reservas` (o tu panel de Mercado Pago, buscando el código `PH-…`).
- **Secretos** (Supabase → Edge Functions → Secrets): `MP_ACCESS_TOKEN` (obligatorio) y
  `MP_WEBHOOK_SECRET` (opcional, valida la firma de las notificaciones).
- **Activación automática:** el botón de Mercado Pago aparece en el checkout solo cuando `MP_ACCESS_TOKEN` es de
  producción. Con credenciales de prueba (`TEST-…`) queda oculto para los clientes; para probarlo abre
  `checkout.html?prueba=1` (o el sitio en local).
- **Pasar a producción:** reemplaza `MP_ACCESS_TOKEN` por el Access Token de producción (`APP_USR-…`). No hay que tocar código.
- **Correos** (desde `reservas@partyhouse.cl`, vía Resend, secreto `RESEND_API_KEY`; plantillas en
  `supabase/functions/pagos/correos.ts`), una sola vez por reserva pagada:
  - **Aviso al dueño**: al correo guardado en la tabla `config` (clave `email_avisos`), con los datos del cliente.
  - **Confirmación al cliente**: código, detalle, saldo, próximos pasos y la fecha adjunta (.ics).
    Las respuestas del cliente llegan al correo de `config.email_avisos`.
  - **Formulario de contacto** (`contacto.html`): cada mensaje llega por correo al mismo destino, listo para responder.

## Analítica (opcional)

`PH.track()` envía eventos (`agregar_carrito`, `click_whatsapp`, `reserva_lista`, `planificador_agregar`,
`planificador_whatsapp`, `agregar_sugerido`) a **Umami** o **Plausible** si su script está cargado. Para activarlo,
crea una cuenta y pega su `<script>` en el `<head>` de las páginas. Sin eso, no hace nada.
