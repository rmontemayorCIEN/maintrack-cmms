/**
 * Lo que una credencial de API puede hacer. Sin dependencias: lo lee la
 * pantalla para que quien crea la credencial elija solo lo necesario.
 *
 * Nada da acceso a usuarios, contraseñas, bitácora ni configuración: esos
 * datos no existen en la API. Los costos se ocultan salvo con `costos:leer`.
 */
export const ALCANCES = {
  "activos:leer": "Consultar activos y su estado",
  "ubicaciones:leer": "Consultar sitios y ubicaciones",
  "ordenes:leer": "Consultar órdenes de trabajo (sin nombres de personas)",
  "solicitudes:crear": "Crear solicitudes de trabajo",
  "lecturas:crear": "Registrar lecturas de medidores y condiciones de sensores",
  "inventario:leer": "Consultar existencias de refacciones",
  "estado:leer": "Consultar el estado general (conteos de pendientes)",
  "costos:leer": "Ver costos en activos, órdenes e inventario",
  "eventos:enviar": "Enviar eventos entrantes (webhook entrante)",
} as const;

export type Alcance = keyof typeof ALCANCES;

export const esAlcance = (a: string): a is Alcance => a in ALCANCES;

/** Límites por minuto. Cada empresa y cada credencial tienen su propio contador. */
export const LIMITES_API = {
  porCredencial: 120,
  porEmpresa: 600,
  /** Lecturas: una pasarela manda en ráfagas; se le da más aire. */
  lecturasPorCredencial: 300,
} as const;
