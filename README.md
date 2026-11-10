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
├── checkout.html       # Reserva: pago del abono con Mercado Pago o WhatsApp
├── pago.html           # Resultado del pago (abono y garantía)
├── arma-tu-fiesta.html # Planificador de fiesta
├── admin.html          # Panel de administración (assets/admin/*.js, assets/admin.css)
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

## 🛠️ Panel de administración (`admin.html`)

**https://partyhouse.cl/admin.html** · estilo Shopify, basado en el panel de Planeta 4 Patas.

**Primer ingreso:** entra a `admin.html` → **¿Primera vez? Crear cuenta** con tu correo (ya está invitado) y una contraseña.
Confirma el correo que llega y vuelve a ingresar.

| Sección | Qué puedes hacer |
|---|---|
| **Inicio** | Reservas y arriendos del mes (vs mes anterior), próximos eventos, tareas: instalaciones de la semana, retiros pendientes, garantías por cobrar/devolver, saldos por cobrar y pagos no completados. |
| **Reservas** | Pestañas (próximas, por instalar, por retirar, realizadas, pagos no completados, canceladas), búsqueda, exportar, imprimir hojas de instalación. |
| **Detalle de reserva** | Etapas (por instalar → instalada → retirada), registrar pago del saldo, garantía (marcar pagada/devuelta, copiar link de pago), cambiar fecha (revisa disponibilidad), confirmar pagos hechos por otro medio, cancelar, WhatsApp listo por etapa, reenviar confirmación por correo, notas internas e historial. |
| **Crear reserva** | Para reservas por WhatsApp/teléfono: productos con precio ajustable, flete por comuna (o manual), descuento, abono recibido y medio. Revisa la disponibilidad en vivo, bloquea la fecha y entra a los recordatorios de garantía. |
| **Calendario** | Mes completo con las reservas de cada día. Toca un día para ver qué productos únicos están libres, **bloquear** un producto, **cerrar el día completo** o crear una reserva ese día. |
| **Garantías** | Por cobrar, por devolver y pendientes de eventos pasados, con WhatsApp directo. |
| **Productos** | Filtros, búsqueda, ficha con **fotos** (arrastrar y soltar, se optimizan solas), precio y precio "antes", textos, qué incluye, insignias, visible/oculto y reglas de reserva: **una sola unidad** (bloqueo automático), **equipo compartido** (carpas que comparte un pack) y **flete incluido**. |
| **Categorías** | Crear, editar, ordenar y ocultar. |
| **Clientes** | Generados desde las reservas: eventos, total, recurrentes, próximo evento, lo que más arriendan. |
| **Análisis** | Cualquier rango (por fecha del evento o de reserva): arriendos por mes, productos, comunas, categorías, día de la semana, anticipación, conversión del pago online. |
| **Configuración** | % de abono, monto de garantía, días de recordatorio, anticipación mínima y meses abiertos · **Flete por comuna** · **Administradores** (invitar y quitar acceso). |

Los cambios de catálogo, flete, bloqueos y ajustes llegan al sitio en ~1 minuto (el sitio los lee de `pagos/datos.js`).

## WhatsApp

El número de contacto está en `assets/site.js` (`PH.waLink`, variable `phone`). Cámbialo ahí si corresponde.

## Arma tu fiesta (`arma-tu-fiesta.html`)

Planificador: el cliente elige tipo de celebración, invitados, nivel y fecha, y recibe un combo con total y abono
que puede agregar al carrito o cotizar por WhatsApp. Las reglas están en la función `recommend()` de esa página.
La sección "Completa tu fiesta" del carrito usa `PH.suggestFor()` en `assets/site.js`.

## Flete, disponibilidad y ajustes

Todo se edita en el panel (Configuración → Flete por comuna, Calendario, Productos, Configuración).
- **Flete:** se suma al total; el abono es el % configurado de (productos + flete). "Otra comuna" se cotiza por WhatsApp.
- **Un pedido = un día:** el carrito aplica una fecha a todo el pedido y el servidor rechaza varias fechas.
- **Disponibilidad:** reservas confirmadas bloquean solas los productos de "una sola unidad" (y su equipo compartido);
  además puedes bloquear productos o cerrar días desde el Calendario.
- `assets/data.js`, `disponibilidad.js` y `transporte.js` quedan **solo como respaldo** si el servidor no responde
  (pueden quedar desactualizados; el cobro siempre usa los datos de la base).

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
