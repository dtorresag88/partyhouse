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

## Analítica (opcional)

`PH.track()` envía eventos (`agregar_carrito`, `click_whatsapp`, `reserva_lista`, `planificador_agregar`,
`planificador_whatsapp`, `agregar_sugerido`) a **Umami** o **Plausible** si su script está cargado. Para activarlo,
crea una cuenta y pega su `<script>` en el `<head>` de las páginas. Sin eso, no hace nada.
