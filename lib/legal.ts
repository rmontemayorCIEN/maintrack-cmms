import { COBRO, PRUEBA_DIAS, RESPALDOS, SEVERIDADES, SOPORTE } from "./comercial";

/**
 * Documentos legales y operativos de MainTrack — BORRADORES.
 *
 * Una sola fuente: las páginas /legal los muestran, la contratación registra
 * la versión aceptada (Organization.terminosVersion) y la documentación
 * comercial remite aquí. Todo dato operativo (prueba, cobro, soporte,
 * respaldos) sale de lib/comercial.ts, para que el documento no diga algo
 * distinto de lo que el sistema hace.
 *
 * NO son asesoría jurídica ni textos definitivos: deben revisarlos un
 * abogado y un especialista en protección de datos antes de firmarse. Los
 * datos del prestador que faltan van entre corchetes, a la vista.
 */

export const VERSION_DOCUMENTOS = "2026-09-borrador-1";
export const ESTADO_DOCUMENTOS = "Borrador para revisión profesional. No constituye asesoría jurídica ni es un texto definitivo.";

/** Lo que falta para completarlos; se muestra en cada documento. */
export const PENDIENTES = "[Razón social del prestador], [RFC], [domicilio] y [ley y tribunales aplicables] están pendientes de definir.";

export type Documento = { clave: string; titulo: string; resumen: string; secciones: Array<{ titulo: string; parrafos: string[] }> };

const severidades = SEVERIDADES.map((s) => `${s.nombre}: ${s.cuando} Respuesta objetivo: Professional ${s.respuesta.PROFESSIONAL}; Enterprise ${s.respuesta.ENTERPRISE}. Actualización: ${s.actualizacion.toLowerCase()}.`);

export const DOCUMENTOS: Documento[] = [
  {
    clave: "contrato",
    titulo: "Contrato de prestación del servicio",
    resumen: "Qué presta MainTrack, qué paga el cliente y cómo termina la relación.",
    secciones: [
      { titulo: "Partes", parrafos: ["[Razón social del prestador] («MainTrack») y la empresa que contrata («el Cliente»), identificada en la solicitud de contratación o en la propuesta aceptada."] },
      { titulo: "Objeto", parrafos: ["MainTrack da al Cliente acceso, por internet, a su plataforma de gestión y confiabilidad del mantenimiento, en el plan contratado y con los límites de ese plan.", "No incluye contabilidad, nómina, facturación fiscal ni pagos a proveedores."] },
      { titulo: "Plan, precio y pago", parrafos: [`Periodicidad: ${COBRO.periodicidad.toLowerCase()}. Moneda: ${COBRO.moneda}. ${COBRO.impuestos}`, COBRO.manual, COBRO.cambioDePlan] },
      { titulo: "Periodo de prueba", parrafos: [COBRO.prueba] },
      { titulo: "Obligaciones de MainTrack", parrafos: ["Mantener el servicio disponible salvo mantenimiento programado o causas fuera de su control; respaldar la información según la Política de respaldos; atender el soporte según la Política de soporte y el Acuerdo de niveles de servicio; mantener separada la información de cada cliente."] },
      { titulo: "Obligaciones del Cliente", parrafos: ["Las descritas en «Responsabilidades del cliente» y en la Política de uso aceptable."] },
      { titulo: "Propiedad de la información", parrafos: ["La información que captura el Cliente es suya. MainTrack la trata solo para prestar el servicio, según el documento de Tratamiento de datos."] },
      { titulo: "Suspensión", parrafos: ["Por falta de pago, después del vencimiento de la nota de cobro y de un aviso, la cuenta puede pasar a solo lectura: se sigue consultando y exportando, pero no se registra nada nuevo. La suspensión no borra información."] },
      { titulo: "Terminación", parrafos: [COBRO.cancelacion] },
      { titulo: "Limitación de responsabilidad", parrafos: ["MainTrack ayuda a anticipar y controlar el mantenimiento, pero no garantiza que no ocurran fallas ni responde por las decisiones de operación del Cliente. [Límite de responsabilidad pendiente de definir con asesoría jurídica]."] },
      { titulo: "Datos del prestador", parrafos: [PENDIENTES] },
    ],
  },
  {
    clave: "terminos",
    titulo: "Términos y condiciones de uso",
    resumen: "Las reglas para usar MainTrack.",
    secciones: [
      { titulo: "Aceptación", parrafos: ["Quien crea una cuenta o usa MainTrack acepta estos términos a nombre de su empresa. La versión aceptada y la fecha quedan registradas en la cuenta."] },
      { titulo: "Cuentas y roles", parrafos: ["Cada persona tiene su propio usuario; las cuentas no se comparten. El administrador del Cliente da de alta a las personas y les asigna un rol, que define qué pueden ver y hacer."] },
      { titulo: "Seguridad de acceso", parrafos: ["Cada persona cuida su contraseña. El Cliente avisa por Soporte si sospecha un acceso indebido y desactiva de inmediato a quien deje la empresa."] },
      { titulo: "Contenido del Cliente", parrafos: ["El Cliente responde de la información, fotos y documentos que sube, y de tener derecho a subirlos."] },
      { titulo: "Funciones de inteligencia artificial", parrafos: ["Las sugerencias de la inteligencia artificial son apoyo, no instrucciones: quien decide es la persona. Los cálculos (costos, indicadores, totales) los hace el sistema, no el modelo."] },
      { titulo: "Cambios al servicio", parrafos: ["MainTrack puede mejorar el servicio. Si un cambio reduce una función contratada, se avisa con anticipación."] },
      { titulo: "Documentos relacionados", parrafos: ["Contrato de prestación del servicio, Aviso de privacidad, Acuerdo de niveles de servicio, Política de soporte, Política de respaldos, Tratamiento de datos, Responsabilidades del cliente, Uso aceptable y Cancelación y terminación."] },
    ],
  },
  {
    clave: "privacidad",
    titulo: "Aviso de privacidad",
    resumen: "Qué datos personales trata MainTrack, para qué y cómo ejercer sus derechos.",
    secciones: [
      { titulo: "Responsable", parrafos: ["[Razón social del prestador], con domicilio en [domicilio]. Para los datos que un cliente captura sobre su personal, el responsable es ese cliente y MainTrack actúa como encargado (ver Tratamiento de datos)."] },
      { titulo: "Datos que se tratan", parrafos: ["De usuarios: nombre, correo, puesto, rol y registro de actividad en la plataforma. De quienes piden una demostración o contratan: nombre, empresa, correo, teléfono (opcional) y lo que escriban sobre su operación. De quien reporta por QR sin cuenta: lo que escriba y, si lo da, su nombre y contacto.", "No se piden datos sensibles."] },
      { titulo: "Finalidades", parrafos: ["Prestar el servicio, identificar a cada usuario, registrar quién hizo qué, dar soporte, atender una solicitud de demostración o contratación, y avisos del servicio. No se venden ni se ceden datos para mercadotecnia de terceros."] },
      { titulo: "Dónde se guardan", parrafos: [`En ${RESPALDOS.ubicacion} La información viaja cifrada y los archivos no son públicos.`] },
      { titulo: "Conservación", parrafos: ["Mientras dure el servicio y después, el tiempo necesario para cumplir obligaciones legales. Las solicitudes de demostración que no avanzan se eliminan a solicitud."] },
      { titulo: "Derechos", parrafos: ["Puede pedir acceso, corrección, cancelación u oposición al tratamiento de sus datos, o revocar su consentimiento. Los usuarios lo piden desde Soporte en MainTrack; otras personas, por el medio que se indique en el contrato o en [medio de contacto pendiente]."] },
      { titulo: "Cambios", parrafos: [`Este aviso puede cambiar; la versión vigente es ${VERSION_DOCUMENTOS}.`] },
    ],
  },
  {
    clave: "sla",
    titulo: "Acuerdo de niveles de servicio",
    resumen: "Qué tan rápido se responde y cómo se maneja un incidente.",
    secciones: [
      { titulo: "Horario y canal", parrafos: [`Horario: ${SOPORTE.horario}`, `Canal: ${SOPORTE.canal}. ${SOPORTE.canalAlterno}`] },
      { titulo: "Severidad y tiempos objetivo", parrafos: [...severidades, "Los tiempos se cuentan en horario hábil desde que se registra la solicitud."] },
      { titulo: "Qué significa cada tiempo", parrafos: ["Respuesta: una persona del equipo confirma que lo revisa. Diagnóstico: se identifica la causa o se descarta. Restauración temporal: una forma de seguir trabajando mientras se corrige. Solución: la corrección definitiva.", "Se comprometen tiempos de respuesta y de actualización. El diagnóstico, la restauración y la solución dependen de la causa: se informa su avance en cada actualización."] },
      { titulo: "Disponibilidad", parrafos: [SOPORTE.disponibilidad] },
      { titulo: "Mantenimiento programado", parrafos: ["Las actualizaciones se publican sin detener el servicio. Si alguna requiere una interrupción, se avisa dentro de MainTrack con al menos 48 horas y se programa fuera del horario hábil."] },
      { titulo: "Exclusiones", parrafos: SOPORTE.noIncluye },
      { titulo: "Incidentes", parrafos: ["Ante un incidente que afecte a varios clientes se informa en MainTrack qué pasa, a quién afecta y cuándo habrá una actualización; al cerrarse se explica la causa y qué se hizo para evitarlo."] },
      { titulo: "Escalamiento", parrafos: ["Si una solicitud no recibe respuesta en el tiempo objetivo, el Cliente puede subir su severidad y agregar información desde la misma solicitud; la atiende directamente el responsable del servicio."] },
    ],
  },
  {
    clave: "soporte",
    titulo: "Política de soporte",
    resumen: "Cómo pedir ayuda y qué esperar.",
    secciones: [
      { titulo: "Cómo pedir ayuda", parrafos: [`${SOPORTE.canal}. ${SOPORTE.canalAlterno}`, "Cada solicitud recibe un folio y se puede consultar su estado en la misma pantalla."] },
      { titulo: "Qué incluir", parrafos: ["Qué intentaba hacer, qué pasó, en qué pantalla, desde cuándo y a quién afecta. Opcionalmente, los datos técnicos del navegador, que MainTrack junta solo si usted lo acepta."] },
      { titulo: "Prioridad", parrafos: severidades },
      { titulo: "Seguimiento y cierre", parrafos: ["Estados: recibida, en revisión, esperando al cliente, resuelta y cerrada. Una solicitud resuelta se cierra cuando el Cliente lo confirma; si no hay respuesta en 5 días hábiles, MainTrack la cierra."] },
      { titulo: "Base de conocimiento y capacitación", parrafos: ["Cada pantalla tiene su ayuda (botón «?»), glosario y la ayuda con inteligencia artificial según el plan. La capacitación se acuerda en la ruta de implementación."] },
    ],
  },
  {
    clave: "respaldos",
    titulo: "Política de respaldos",
    resumen: "Cómo se protege la información contra pérdida.",
    secciones: [
      { titulo: "Qué se respalda", parrafos: [RESPALDOS.diario, RESPALDOS.puntoEnElTiempo, "Los archivos (fotos y documentos) viven en un almacén privado de Google Cloud, separado por empresa."] },
      { titulo: "Dónde", parrafos: [RESPALDOS.ubicacion] },
      { titulo: "Restauración", parrafos: ["Se restaura ante una falla de la plataforma. La restauración de la información de un solo cliente por un error propio (por ejemplo, un borrado) se evalúa caso por caso, dentro de la ventana de 7 días."] },
      { titulo: "Exportación", parrafos: ["El Cliente puede exportar sus listas principales a CSV en cualquier momento como copia propia."] },
    ],
  },
  {
    clave: "datos",
    titulo: "Tratamiento de datos",
    resumen: "Cómo trata MainTrack la información de cada cliente.",
    secciones: [
      { titulo: "Papel de cada parte", parrafos: ["El Cliente decide qué datos captura y para qué (responsable). MainTrack los trata solo para prestar el servicio y por instrucciones del Cliente (encargado)."] },
      { titulo: "Separación", parrafos: ["Cada empresa ve solo su información. Toda consulta se filtra por empresa, los archivos llevan la empresa en su ruta y cada descarga se autoriza por unos minutos."] },
      { titulo: "Acceso del personal de MainTrack", parrafos: ["Solo para dar soporte o mantener el servicio, y queda registrado en la bitácora de auditoría."] },
      { titulo: "Proveedores", parrafos: ["Google Cloud (infraestructura, base de datos y archivos, en Estados Unidos). Anthropic (funciones de inteligencia artificial: se envía solo la información necesaria para la función que se usa, y no se usa para entrenar modelos según sus condiciones comerciales)."] },
      { titulo: "Integraciones", parrafos: ["Si el Cliente conecta otro sistema por API o avisos automáticos, la información que sale hacia ese sistema queda bajo la responsabilidad del Cliente."] },
      { titulo: "Al terminar", parrafos: [COBRO.cancelacion] },
    ],
  },
  {
    clave: "responsabilidades",
    titulo: "Responsabilidades del cliente",
    resumen: "Lo que le toca al cliente para que MainTrack funcione.",
    secciones: [
      { titulo: "Personas", parrafos: ["Nombrar un administrador; dar de alta, cambiar de rol y desactivar a las personas a tiempo."] },
      { titulo: "Información", parrafos: ["Capturar o importar sus equipos, refacciones, planes y medidores, y mantenerlos al día. La calidad de los indicadores depende de lo que se registra."] },
      { titulo: "Operación", parrafos: ["Registrar el trabajo realizado, cerrar las órdenes y revisar los avisos. Decidir sobre el mantenimiento: MainTrack apoya, no decide."] },
      { titulo: "Equipos y conexión", parrafos: ["Contar con navegador actualizado y conexión a internet en los lugares donde se trabaje con MainTrack."] },
      { titulo: "Seguridad", parrafos: ["Cuidar las contraseñas, no compartir cuentas y avisar por Soporte de cualquier acceso sospechoso."] },
    ],
  },
  {
    clave: "uso-aceptable",
    titulo: "Uso aceptable",
    resumen: "Lo que no se permite hacer con MainTrack.",
    secciones: [
      { titulo: "No se permite", parrafos: ["Intentar entrar a la información de otra empresa o a funciones que el rol no permite.", "Subir archivos con programas maliciosos o contenido ilegal.", "Usar la API para cargas excesivas que afecten a otros clientes.", "Revender el acceso sin un acuerdo con MainTrack.", "Copiar la plataforma o intentar obtener su código."] },
      { titulo: "Consecuencias", parrafos: ["MainTrack puede bloquear el acceso de una persona o una credencial de API que ponga en riesgo el servicio, y avisa al administrador del Cliente."] },
    ],
  },
  {
    clave: "cancelacion",
    titulo: "Cancelación y terminación",
    resumen: "Cómo se termina el servicio y qué pasa con la información.",
    secciones: [
      { titulo: "Por el Cliente", parrafos: [COBRO.cancelacion, "Se solicita desde Soporte en MainTrack."] },
      { titulo: "Al terminar la prueba", parrafos: [`Si al terminar los ${PRUEBA_DIAS} días de prueba no se contrata un plan, la cuenta queda en solo lectura. No se genera ningún cargo.`] },
      { titulo: "Por falta de pago", parrafos: ["Ver Suspensión en el contrato: la cuenta pasa a solo lectura; la información no se borra."] },
      { titulo: "Exportación y eliminación", parrafos: ["Antes y después de terminar, el Cliente puede exportar sus listas a CSV. La eliminación definitiva se hace a solicitud escrita y se confirma cuando se completa; los respaldos se eliminan al cumplir su ciclo de 7 días."] },
    ],
  },
];

export function documento(clave: string) {
  return DOCUMENTOS.find((d) => d.clave === clave) ?? null;
}
