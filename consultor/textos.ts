// Los textos que lee la persona, en el trato de cada app: Agente 360 habla de
// tú; Maintrack, de usted. Mezclarlos en una misma pantalla se nota y se lee
// descuidado, así que el trato viaja en el perfil de la app y todo texto
// visible del Consultor sale de aquí.

export type Trato = "tu" | "usted";

const TU = {
  etapaOperacion: "Arranque terminado: ya estás en operación",
  pasosHechos: (h: number, t: number) => `${h} de ${t} pasos hechos, calculado con tus datos de este momento.`,
  explicamelo: "Explícamelo",
  pideExplicar: (titulo: string) => `Explícame paso a paso cómo hacer «${titulo}».`,
  sigueTodoHecho: "Sigue preguntándome lo que necesites para el día a día.",
  noDependeDeTi: "Lo que falta no depende de ti",
  delAdmin: (lista: string, n: number) => `${n === 1 ? "Un paso pendiente" : `${n} pasos pendientes`} solo los puede hacer quien administra la cuenta: ${lista}. Pídeselo; tú sigue con lo tuyo.`,
  pregunta: "Pregúntale al Consultor",
  entrevista: "Antes de empezar, tres preguntas para acomodar el plan a lo que buscas. Puedes saltarlas.",
  vacio: (app: string) => `Pregúntame qué sigue, cómo se hace algo en ${app} o por qué algo no funciona. Solo hablo del sistema.`,
  soloLectura: "La cuenta está en solo lectura: puedes ver el plan, pero no conversar.",
  tope: (n: number) => `Llegaste a las ${n} preguntas de hoy. Mañana sigo contigo; el plan de arriba sigue al día.`,
  escribe: "Escribe tu pregunta sobre el sistema",
  quedan: (n: number) => `Te quedan ${n} preguntas hoy. No escribas datos de tus clientes: no los necesito.`,
  errorRed: "No se pudo completar. Revisa tu conexión e intenta de nuevo.",
  recuerdo: "Lo que recuerdo de tu cuenta",
  notasVacio: "Todavía nada. Lo que me digas que conviene recordar te lo propongo aquí, y tú decides si se guarda.",
  apagaste: (t: string) => `Apagaste «${t}».`,
  // reglas
  dondeTeQuedaste: "Es donde te quedaste la última vez.",
  yaEmpezaste: "Ya lo empezaste: terminarlo vale más que abrir otro.",
  fueraDeTema: (app: string) => `Solo puedo ayudarte con ${app}: cómo arrancarlo, configurarlo y usarlo en tu día. Pregúntame lo que quieras de eso; por ejemplo, «¿qué me falta para terminar de implementarlo?».`,
  consejo: (temas: string, app: string) => `Esa decisión no me toca: no doy consejo de ${temas}. Lo que sí puedo es explicarte cómo registrarlo, consultarlo o darle seguimiento en ${app}.`,
  escribePregunta: "Escribe tu pregunta.",
  preguntaLarga: (n: number) => `La pregunta pasa de ${n} caracteres: divídela en dos.`,
  apagaAlguna: (n: number) => `Ya hay ${n} notas: apaga alguna que ya no sirva.`,
  contestaUna: "Contesta al menos una pregunta, o sáltate la entrevista.",
  noEntendi: "No entendí la pregunta. ¿Me la dices de otra forma?",
  cifrasAjenas: "La respuesta traía cifras que no salen de tus datos; no se muestra. Pregunta de nuevo.",
  sinRespuesta: "No pude armar una respuesta. Intenta de nuevo.",
  entrevistaFecha: "¿Para cuándo quieres estar operando?",
  entrevistaMeta: "¿Qué quieres lograr primero con el sistema?",
  trato: "de tú",
};

export type Textos = typeof TU;

const USTED: Textos = {
  etapaOperacion: "Arranque terminado: ya está en operación",
  pasosHechos: (h, t) => `${h} de ${t} pasos hechos, calculado con sus datos de este momento.`,
  explicamelo: "Explíquemelo",
  pideExplicar: (titulo) => `Explíqueme paso a paso cómo hacer «${titulo}».`,
  sigueTodoHecho: "Siga preguntándome lo que necesite para el día a día.",
  noDependeDeTi: "Lo que falta no depende de usted",
  delAdmin: (lista, n) => `${n === 1 ? "Un paso pendiente" : `${n} pasos pendientes`} solo los puede hacer quien administra la cuenta: ${lista}. Pídaselo; usted siga con lo suyo.`,
  pregunta: "Pregúntele al Consultor",
  entrevista: "Antes de empezar, tres preguntas para acomodar el plan a lo que busca. Puede saltarlas.",
  vacio: (app) => `Pregúnteme qué sigue, cómo se hace algo en ${app} o por qué algo no funciona. Solo hablo del sistema.`,
  soloLectura: "La cuenta está en solo lectura: puede ver el plan, pero no conversar.",
  tope: (n) => `Llegó a las ${n} preguntas de hoy. Mañana sigo con usted; el plan de arriba sigue al día.`,
  escribe: "Escriba su pregunta sobre el sistema",
  quedan: (n) => `Le quedan ${n} preguntas hoy. No escriba datos personales: no los necesito.`,
  errorRed: "No se pudo completar. Revise su conexión e intente de nuevo.",
  recuerdo: "Lo que recuerdo de su cuenta",
  notasVacio: "Todavía nada. Lo que me diga que conviene recordar se lo propongo aquí, y usted decide si se guarda.",
  apagaste: (t) => `Apagó «${t}».`,
  dondeTeQuedaste: "Es donde se quedó la última vez.",
  yaEmpezaste: "Ya lo empezó: terminarlo vale más que abrir otro.",
  fueraDeTema: (app) => `Solo puedo ayudarle con ${app}: cómo arrancarlo, configurarlo y usarlo en su día. Pregúnteme lo que quiera de eso; por ejemplo, «¿qué me falta para terminar de implementarlo?».`,
  consejo: (temas, app) => `Esa decisión no me toca: no doy consejo de ${temas}. Lo que sí puedo es explicarle cómo registrarlo, consultarlo o darle seguimiento en ${app}.`,
  escribePregunta: "Escriba su pregunta.",
  preguntaLarga: (n) => `La pregunta pasa de ${n} caracteres: divídala en dos.`,
  apagaAlguna: (n) => `Ya hay ${n} notas: apague alguna que ya no sirva.`,
  contestaUna: "Conteste al menos una pregunta, o sáltese la entrevista.",
  noEntendi: "No entendí la pregunta. ¿Me la dice de otra forma?",
  cifrasAjenas: "La respuesta traía cifras que no salen de sus datos; no se muestra. Pregunte de nuevo.",
  sinRespuesta: "No pude armar una respuesta. Intente de nuevo.",
  entrevistaFecha: "¿Para cuándo quiere estar operando?",
  entrevistaMeta: "¿Qué quiere lograr primero con el sistema?",
  trato: "de usted",
};

export function textos(trato: Trato | undefined): Textos {
  return trato === "usted" ? USTED : TU;
}
