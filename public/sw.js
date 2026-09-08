/*
 * Service worker de MainTrack. Existe SOLO para recibir avisos.
 *
 * A proposito NO guarda la aplicacion para trabajar sin red. Next reparte el
 * codigo en archivos con un identificador que cambia en cada publicacion; un
 * cache mal invalidado deja al usuario con media aplicacion vieja y media
 * nueva, y eso se ve como errores al azar que nadie logra reproducir. Si algun
 * dia se quiere modo sin conexion, se hace aparte y con su propia prueba.
 *
 * Este archivo lo ejecuta el navegador, no pasa por TypeScript ni por la
 * compilacion: aqui no hay red de seguridad, se revisa a mano.
 */

// Una version nueva toma el control de inmediato, sin esperar a que el usuario
// cierre todas las pestanas. Sin esto, un arreglo aqui puede tardar dias en
// llegarle a alguien que nunca cierra la aplicacion.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));

/** Lo que se muestra cuando el mensaje viene vacio o ilegible. */
const RESPALDO = {
  title: "MainTrack",
  body: "Tiene un aviso nuevo.",
  link: "/dashboard",
};

self.addEventListener("push", (evento) => {
  let datos = RESPALDO;
  try {
    if (evento.data) datos = Object.assign({}, RESPALDO, evento.data.json());
  } catch (_) {
    // Un mensaje que no es JSON no debe dejar al usuario sin aviso: se muestra
    // el generico y al abrirlo ve la lista completa.
  }

  const opciones = {
    body: datos.body,
    icon: "/icono-192.png",
    // Android pinta la insignia de un solo color en la barra de estado.
    badge: "/insignia-96.png",
    /*
     * `tag` agrupa: un segundo aviso con el MISMO tag reemplaza al anterior,
     * en vez de apilar tres notificaciones de la misma orden.
     *
     * Sin tag no se agrupa nada, y asi tiene que ser: un valor fijo por
     * omision haria que cada aviso borrara al anterior, y una falla nueva
     * taparia la de hace un minuto sin que nadie la hubiera visto.
     */
    tag: datos.tag || undefined,
    renotify: Boolean(datos.tag),
    // Los avisos importantes se quedan hasta que la persona los toca. El de
    // "ya llego la refaccion" no sirve si se borro solo mientras almorzaba.
    requireInteraction: datos.importante === true,
    data: { link: datos.link || RESPALDO.link },
    lang: "es-MX",
  };

  evento.waitUntil(self.registration.showNotification(datos.title, opciones));
});

self.addEventListener("notificationclick", (evento) => {
  evento.notification.close();
  const destino = new URL(
    (evento.notification.data && evento.notification.data.link) || RESPALDO.link,
    self.location.origin,
  ).href;

  evento.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((ventanas) => {
      // Si ya hay una ventana de MainTrack abierta se reutiliza. Abrir una
      // nueva cada vez deja al tecnico con ocho pestanas de la misma orden.
      for (const ventana of ventanas) {
        if (new URL(ventana.url).origin === self.location.origin && "focus" in ventana) {
          return ventana.focus().then((v) => (v && v.navigate ? v.navigate(destino) : v));
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});

/*
 * El navegador rota la suscripcion por su cuenta cada cierto tiempo.
 *
 * Cuando pasa, la suscripcion vieja deja de servir y el servidor sigue
 * mandando a una direccion muerta: el usuario cree que esta avisado y no lo
 * esta. Aqui se vuelve a suscribir y se avisa al servidor.
 */
self.addEventListener("pushsubscriptionchange", (evento) => {
  evento.waitUntil(
    (async () => {
      try {
        const anterior = evento.oldSubscription || (await self.registration.pushManager.getSubscription());
        const llave = (evento.oldSubscription && evento.oldSubscription.options.applicationServerKey)
          || (anterior && anterior.options && anterior.options.applicationServerKey);
        if (!llave) return;

        const nueva = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: llave,
        });
        await fetch("/api/avisos/suscripcion", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suscripcion: nueva.toJSON(),
            reemplaza: anterior ? anterior.endpoint : null,
          }),
        });
      } catch (_) {
        // Si falla, la limpieza del servidor la dara de baja al primer envio
        // rechazado y el usuario vera su dispositivo como desconectado.
      }
    })(),
  );
});
