// Party House — valores de flete y montaje por comuna
// ---------------------------------------------------------------
// ESTE ARCHIVO LO EDITAS TÚ. Se puede editar directo en GitHub (lápiz) y el sitio
// y el cobro con Mercado Pago se actualizan solos en ~1 minuto.
//
// - comunas: nombre como lo verá el cliente y valor en pesos (sin puntos).
//   El flete se suma al total del pedido y el abono es el 50% de ese total.
//   Cada pedido es para un solo día, así que se cobra un flete por pedido.
// - Si el cliente elige "Otra comuna", no se puede pagar online: se cotiza por WhatsApp.
// - sinFlete: productos que ya incluyen su transporte. Si el pedido trae SOLO
//   productos de esta lista, no se cobra flete.
// ---------------------------------------------------------------
window.PH_TRANSPORTE = {
  comunas: [
    { nombre: 'Las Condes', valor: 15000 },
    { nombre: 'Vitacura', valor: 15000 },
    { nombre: 'Lo Barnechea', valor: 20000 },
    { nombre: 'Providencia', valor: 20000 },
    { nombre: 'Ñuñoa', valor: 20000 },
    { nombre: 'La Reina', valor: 20000 },
    { nombre: 'Peñalolén', valor: 25000 },
    { nombre: 'Chicureo / Chamisero', valor: 25000 },
    { nombre: 'Colina', valor: 30000 },
    { nombre: 'Macul', valor: 30000 },
    { nombre: 'Lampa', valor: 40000 },
    { nombre: 'La Florida / Puente Alto', valor: 40000 },
    { nombre: 'Padre Hurtado', valor: 40000 },
    { nombre: 'Maipú', valor: 45000 },
    { nombre: 'San Bernardo / Talagante / Calera de Tango', valor: 50000 }
  ],

  sinFlete: [
    'maquina-de-sour-frozen-granizado'
  ]
};
