// Party House — disponibilidad de reservas
// ---------------------------------------------------------------
// ESTE ARCHIVO LO EDITAS TÚ cada vez que se confirma una reserva.
// Se puede editar directo en GitHub (ícono del lápiz) y el sitio se
// actualiza solo en ~1 minuto.
//
// Fechas siempre en formato 'AAAA-MM-DD', entre comillas y separadas por comas.
//   Ejemplo: ['2026-12-05', '2026-12-12']
//
// - diasAnticipacion: con cuántos días mínimo se puede reservar.
// - mesesMaximo: hasta cuántos meses hacia adelante se muestra el calendario.
// - cerrado: días en que NO se atiende (feriados, vacaciones). Bloquea todo el catálogo.
// - ocupado: por producto (usa el id que aparece en la URL: producto.html?id=...).
//   Agrega la fecha cuando ya no te quedan unidades de ese producto para ese día.
// ---------------------------------------------------------------
window.PH_DISPONIBILIDAD = {
  diasAnticipacion: 3,
  mesesMaximo: 4,

  cerrado: [
    // '2026-12-25',
  ],

  ocupado: {
    'party-cube-5x5-mts': [],
    'party-house-5x8-mts': [],
    'pack-vip-lounge-5x5-mts': [],
    'pack-vip-lounge-5x8-mts': [],
    'maquina-de-sour-frozen-granizado': []
  },

  // Productos que usan el mismo equipo físico: si uno está ocupado, los otros también.
  // (Ej.: el Pack VIP 5×5 usa la misma carpa que el Party Cube 5×5.) Ajusta si tienes más de una carpa.
  comparten: [
    ['party-cube-5x5-mts', 'pack-vip-lounge-5x5-mts'],
    ['party-house-5x8-mts', 'pack-vip-lounge-5x8-mts']
  ]
};
