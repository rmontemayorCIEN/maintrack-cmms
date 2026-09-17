"use client";

import { useZona } from "@/components/zona-empresa";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BellRing, Check, Info, Loader2, Send, Smartphone, TriangleAlert, Trash2,
} from "lucide-react";
import { Button, Card } from "@/components/ui";
import {
  INSTRUCTIVOS, plataformaDe, type ClavePlataforma,
} from "@/lib/avisos-instrucciones";

/**
 * Avisos al celular: encendido de la empresa, activacion del aparato y el
 * instructivo para lograrlo.
 *
 * La pantalla se disena para el telefono primero, porque es donde se usa: la
 * persona esta parada con el telefono en la mano siguiendo los pasos. En la
 * computadora sobra espacio y no pasa nada; al reves, no cabe.
 */

type Dispositivo = {
  id: string;
  endpoint: string;
  dispositivo: string;
  createdAt: string;
  ultimoEnvioAt: string | null;
  fallos: number;
};

type Estado =
  | "CARGANDO"
  /** El servidor no tiene llaves: no hay nada que ofrecer. */
  | "SIN_LLAVES"
  /** Navegador viejo, o iPhone con iOS anterior a 16.4. */
  | "NO_SOPORTADO"
  /** iPhone sin instalar: hay que agregarlo a inicio antes de poder activar. */
  | "FALTA_INSTALAR"
  | "LISTO_PARA_ACTIVAR"
  /** El sistema operativo tiene bloqueadas las notificaciones. */
  | "BLOQUEADO"
  | "ACTIVO";

/**
 * La llave publica viaja en texto y el navegador la quiere en bytes.
 * Ademas viene en base64 "seguro para URL", que cambia dos caracteres.
 */
function llaveABytes(base64url: string): Uint8Array {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i += 1) bytes[i] = crudo.charCodeAt(i);
  return bytes;
}

/** Si la aplicacion se abrio desde el icono y no desde el navegador. */
function estaInstalada(): boolean {
  if (typeof window === "undefined") return false;
  const iosInstalada = (window.navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia("(display-mode: standalone)").matches || iosInstalada === true;
}

function fecha(iso: string | null, zona: string) {
  if (!iso) return "todavía no recibe nada";
  return new Date(iso).toLocaleString("es-MX", {
    day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: zona,
  });
}

export function PanelAvisos({
  encendidoInicial,
  puedeEditar,
}: {
  encendidoInicial: boolean;
  puedeEditar: boolean;
}) {
  const zona = useZona();
  const router = useRouter();
  const [encendido, setEncendido] = useState(encendidoInicial);
  const [guardandoOrg, setGuardandoOrg] = useState(false);
  const [estado, setEstado] = useState<Estado>("CARGANDO");
  const [llave, setLlave] = useState<string | null>(null);
  const [dispositivos, setDispositivos] = useState<Dispositivo[]>([]);
  const [miEndpoint, setMiEndpoint] = useState<string | null>(null);
  const [plataforma, setPlataforma] = useState<ClavePlataforma>("ESCRITORIO");
  const [instalada, setInstalada] = useState(false);
  const [verOtras, setVerOtras] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const soportado =
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window;

  const revisar = useCallback(async () => {
    const esIos = plataformaDe(navigator.userAgent, navigator.maxTouchPoints) === "IOS";
    const yaInstalada = estaInstalada();
    setPlataforma(plataformaDe(navigator.userAgent, navigator.maxTouchPoints));
    setInstalada(yaInstalada);

    const res = await fetch("/api/avisos/suscripcion");
    if (!res.ok) {
      setEstado("SIN_LLAVES");
      return;
    }
    const datos = await res.json();
    setLlave(datos.llavePublica);
    setEncendido(datos.encendido);
    setDispositivos(datos.dispositivos ?? []);

    if (!datos.disponible) {
      setEstado("SIN_LLAVES");
      return;
    }
    // En iPhone se revisa ANTES que el soporte del navegador: sin instalar,
    // Safari ni siquiera expone el mecanismo, y decir "su navegador no puede"
    // mandaria a la persona a cambiar de navegador en vez de instalarla.
    if (esIos && !yaInstalada) {
      setEstado("FALTA_INSTALAR");
      return;
    }
    if (!soportado) {
      setEstado("NO_SOPORTADO");
      return;
    }
    if (Notification.permission === "denied") {
      setEstado("BLOQUEADO");
      return;
    }

    /**
     * La verdad de si este aparato esta activo la tiene el navegador, no la
     * base de datos. Se pregunta aqui y, si el servidor no lo tiene, se vuelve
     * a dar de alta: asi se repara solo el caso de la suscripcion que el
     * navegador roto sin avisar.
     */
    try {
      const registro = await navigator.serviceWorker.getRegistration();
      const suscripcion = await registro?.pushManager.getSubscription();
      if (suscripcion) {
        setMiEndpoint(suscripcion.endpoint);
        const conocida = (datos.dispositivos ?? []).some(
          (d: Dispositivo) => d.endpoint === suscripcion.endpoint,
        );
        if (!conocida) {
          await fetch("/api/avisos/suscripcion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suscripcion: suscripcion.toJSON(), instalada: yaInstalada }),
          });
          const otra = await fetch("/api/avisos/suscripcion").then((r) => r.json());
          setDispositivos(otra.dispositivos ?? []);
        }
        setEstado("ACTIVO");
        return;
      }
    } catch {
      /* Sin registro previo: se trata como no activado. */
    }
    setEstado("LISTO_PARA_ACTIVAR");
  }, [soportado]);

  useEffect(() => {
    revisar().catch(() => setEstado("SIN_LLAVES"));
  }, [revisar]);

  async function activar() {
    setTrabajando(true);
    setError(null);
    setMensaje(null);
    try {
      /**
       * El permiso se pide PRIMERO, antes de cualquier espera.
       *
       * Safari exige que la peticion salga del toque de la persona. Si antes
       * se registra el service worker y se espera, el navegador ya no la
       * considera provocada por el usuario y la rechaza sin preguntar nada.
       */
      const permiso = await Notification.requestPermission();
      if (permiso === "denied") {
        setEstado("BLOQUEADO");
        return;
      }
      if (permiso !== "granted") {
        setError("No se concedió el permiso. Puede volver a intentarlo.");
        return;
      }
      if (!llave) {
        setError("El servidor no entregó la llave de avisos. Repórtelo a soporte.");
        return;
      }

      const registro = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      // Si quedo una suscripcion de una llave anterior, hay que retirarla:
      // suscribirse con otra llave sobre una vigente falla.
      const previa = await registro.pushManager.getSubscription();
      if (previa) await previa.unsubscribe().catch(() => undefined);

      const suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: llaveABytes(llave) as BufferSource,
      });

      const res = await fetch("/api/avisos/suscripcion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suscripcion: suscripcion.toJSON(), instalada: estaInstalada() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "No fue posible registrar este aparato.");
        return;
      }
      setMiEndpoint(suscripcion.endpoint);
      setMensaje("Aparato activado. Mándese un aviso de prueba para comprobarlo.");
      await revisar();
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "El sistema tiene bloqueadas las notificaciones para este sitio."
          : "No fue posible activar los avisos en este aparato.",
      );
    } finally {
      setTrabajando(false);
    }
  }

  async function desactivar(id?: string) {
    setTrabajando(true);
    setError(null);
    setMensaje(null);
    try {
      // Se da de baja de los dos lados. Solo en el servidor dejaria al
      // navegador creyendo que sigue suscrito y no volveria a ofrecer activar.
      const esEsteAparato = !id || dispositivos.find((d) => d.id === id)?.endpoint === miEndpoint;
      if (esEsteAparato) {
        const registro = await navigator.serviceWorker.getRegistration();
        const suscripcion = await registro?.pushManager.getSubscription();
        await suscripcion?.unsubscribe().catch(() => undefined);
      }
      await fetch("/api/avisos/suscripcion", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : { endpoint: miEndpoint }),
      });
      if (esEsteAparato) setMiEndpoint(null);
      await revisar();
      setMensaje("Este aparato ya no recibirá avisos.");
    } finally {
      setTrabajando(false);
    }
  }

  async function probar() {
    setTrabajando(true);
    setError(null);
    setMensaje(null);
    const res = await fetch("/api/avisos/prueba", { method: "POST" });
    const datos = await res.json().catch(() => ({}));
    setTrabajando(false);
    if (datos.entregados > 0) setMensaje(datos.mensaje);
    else setError(datos.mensaje ?? "No fue posible mandar la prueba.");
    await revisar();
  }

  async function cambiarOrg(valor: boolean) {
    setGuardandoOrg(true);
    setError(null);
    const res = await fetch("/api/avisos/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avisosPush: valor }),
    });
    setGuardandoOrg(false);
    if (res.ok) {
      setEncendido(valor);
      router.refresh();
    } else {
      setError("No fue posible guardar.");
    }
  }

  const instructivo = INSTRUCTIVOS[plataforma];
  const otras = (["IOS", "ANDROID", "ESCRITORIO"] as ClavePlataforma[]).filter(
    (p) => p !== plataforma,
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      {/* ── Columna izquierda: el interruptor y este aparato ─────────────── */}
      <div className="grid gap-4">
        <Card>
          <div className="grid gap-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Avisos al celular</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Lo que hoy aparece en la campana puede llegar además al teléfono, aunque
                MainTrack esté cerrado. No cuesta nada por mensaje.
              </p>
            </div>

            {estado === "SIN_LLAVES" ? (
              <Aviso tono="malo" icono={<TriangleAlert className="h-4 w-4" />}>
                El servidor todavía no tiene configurados los avisos. Esto lo resuelve el
                operador de la plataforma; no hay nada que hacer desde aquí.
              </Aviso>
            ) : null}

            <label className="flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={encendido}
                disabled={!puedeEditar || guardandoOrg || estado === "SIN_LLAVES"}
                onChange={(e) => cambiarOrg(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span>
                <span className="block text-xs font-medium text-slate-800">
                  Esta empresa manda avisos al teléfono de su gente
                </span>
                <span className="mt-0.5 block text-[0.6875rem] leading-relaxed text-slate-500">
                  Apagado, nadie recibe nada aunque tenga su aparato activado —los aparatos no
                  se borran y vuelven a servir si se enciende otra vez.
                  <br />
                  Encenderlo no activa a nadie: cada persona tiene que activar su propio
                  teléfono con los pasos de al lado. Eso es del navegador, no se puede hacer
                  por ellos.
                </span>
              </span>
            </label>

            {!puedeEditar ? (
              <p className="text-[0.6875rem] leading-relaxed text-slate-500">
                Solo un administrador puede encender o apagar esto para toda la empresa.
                {!encendido ? " Hoy está apagado, así que aún activando su aparato no llegará nada." : ""}
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="grid gap-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Este aparato</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {instructivo.titulo}
                  {instalada ? " · instalada" : " · en el navegador"}
                </p>
              </div>
              <EstadoChip estado={estado} />
            </div>

            {estado === "CARGANDO" ? (
              <p className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Revisando…
              </p>
            ) : null}

            {estado === "FALTA_INSTALAR" ? (
              <Aviso tono="ojo" icono={<Info className="h-4 w-4" />}>
                En iPhone hay que agregar MainTrack a la pantalla de inicio antes de poder
                activar los avisos. Los pasos están a la derecha —o abajo, si está en el
                teléfono—. Es una regla de Apple: no hay forma de saltárselo.
              </Aviso>
            ) : null}

            {estado === "NO_SOPORTADO" ? (
              <Aviso tono="ojo" icono={<TriangleAlert className="h-4 w-4" />}>
                Este navegador no puede recibir avisos. En iPhone se necesita iOS 16.4 o más
                nuevo; en computadora, una versión reciente de Chrome, Edge o Firefox.
              </Aviso>
            ) : null}

            {estado === "BLOQUEADO" ? (
              <div className="grid gap-2">
                <Aviso tono="malo" icono={<TriangleAlert className="h-4 w-4" />}>
                  El sistema tiene bloqueadas las notificaciones para MainTrack. Desde aquí ya
                  no se puede pedir permiso: hay que desbloquearlo en los ajustes del aparato.
                </Aviso>
                <ol className="ml-4 grid list-decimal gap-1 text-[0.6875rem] leading-relaxed text-slate-600">
                  {instructivo.bloqueado.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {estado === "ACTIVO" ? (
              <Aviso tono="bien" icono={<Check className="h-4 w-4" />}>
                Este aparato está activado. Mándese un aviso de prueba: es la única forma de
                comprobar que de verdad llega.
              </Aviso>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {estado === "LISTO_PARA_ACTIVAR" ? (
                <Button onClick={activar} disabled={trabajando}>
                  {trabajando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BellRing className="h-4 w-4" />
                  )}
                  Activar en este aparato
                </Button>
              ) : null}

              {estado === "ACTIVO" ? (
                <>
                  <Button onClick={probar} disabled={trabajando}>
                    {trabajando ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Mandarme una prueba
                  </Button>
                  <Button variant="secondary" onClick={() => desactivar()} disabled={trabajando}>
                    Dejar de recibir aquí
                  </Button>
                </>
              ) : null}
            </div>

            {mensaje ? <p className="text-xs text-emerald-700">{mensaje}</p> : null}
            {error ? <p className="text-xs text-red-600">{error}</p> : null}
          </div>
        </Card>

        {dispositivos.length ? (
          <Card>
            <div className="grid gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  Sus aparatos ({dispositivos.length})
                </h2>
                <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">
                  Los avisos llegan a todos. Se activa aparato por aparato: hacerlo en el
                  teléfono no lo activa en la tableta.
                </p>
              </div>
              <ul className="grid gap-1.5">
                {dispositivos.map((d) => {
                  const esEste = d.endpoint === miEndpoint;
                  return (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2.5 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <Smartphone className="h-4 w-4 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-slate-800">
                            {d.dispositivo}
                            {esEste ? (
                              <span className="ml-1.5 rounded bg-slate-900 px-1.5 py-0.5 text-[0.625rem] font-medium text-white">
                                este
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-[0.6875rem] text-slate-500">
                            Último aviso: {fecha(d.ultimoEnvioAt, zona)}
                            {d.fallos > 2 ? ` · ${d.fallos} intentos sin llegar` : ""}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => desactivar(d.id)}
                        disabled={trabajando}
                        aria-label={`Quitar ${d.dispositivo}`}
                        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </Card>
        ) : null}
      </div>

      {/* ── Columna derecha: el instructivo ──────────────────────────────── */}
      <Card>
        <div className="grid gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              Cómo activarlo en {instructivo.titulo}
            </h2>
            <p className="mt-1 text-[0.6875rem] leading-relaxed text-slate-600">
              {instructivo.porque}
            </p>
          </div>

          <ol className="grid gap-2">
            {instructivo.pasos.map((paso, i) => (
              <li key={paso} className="flex gap-2.5">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-slate-900 text-[0.625rem] font-semibold text-white">
                  {i + 1}
                </span>
                <span className="text-xs leading-relaxed text-slate-700">{paso}</span>
              </li>
            ))}
          </ol>

          {instructivo.advertencias?.length ? (
            <div className="rounded-lg bg-amber-50 p-2.5">
              <p className="text-[0.6875rem] font-semibold text-amber-900">Tenga en cuenta</p>
              <ul className="mt-1 ml-3.5 grid list-disc gap-1">
                {instructivo.advertencias.map((a) => (
                  <li key={a} className="text-[0.6875rem] leading-relaxed text-amber-900">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <button
              type="button"
              onClick={() => setVerOtras((v) => !v)}
              className="text-[0.6875rem] font-medium text-slate-600 underline underline-offset-2 hover:text-slate-900"
            >
              {verOtras ? "Ocultar" : "Ver"} los pasos para los otros aparatos
            </button>
            {verOtras ? (
              <div className="mt-3 grid gap-4">
                {otras.map((clave) => {
                  const otro = INSTRUCTIVOS[clave];
                  return (
                    <div key={clave} className="border-t border-slate-200 pt-3">
                      <p className="text-xs font-semibold text-slate-800">{otro.titulo}</p>
                      <p className="mt-0.5 text-[0.6875rem] leading-relaxed text-slate-500">
                        {otro.porque}
                      </p>
                      <ol className="mt-2 ml-4 grid list-decimal gap-1">
                        {otro.pasos.map((p) => (
                          <li key={p} className="text-[0.6875rem] leading-relaxed text-slate-600">
                            {p}
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </Card>
    </div>
  );
}

function EstadoChip({ estado }: { estado: Estado }) {
  const MAPA: Record<Estado, { texto: string; clase: string }> = {
    CARGANDO: { texto: "Revisando", clase: "bg-slate-100 text-slate-600" },
    SIN_LLAVES: { texto: "No disponible", clase: "bg-slate-100 text-slate-600" },
    NO_SOPORTADO: { texto: "No compatible", clase: "bg-amber-100 text-amber-800" },
    FALTA_INSTALAR: { texto: "Falta instalar", clase: "bg-amber-100 text-amber-800" },
    LISTO_PARA_ACTIVAR: { texto: "Sin activar", clase: "bg-slate-100 text-slate-600" },
    BLOQUEADO: { texto: "Bloqueado", clase: "bg-red-100 text-red-700" },
    ACTIVO: { texto: "Activado", clase: "bg-emerald-100 text-emerald-800" },
  };
  const { texto, clase } = MAPA[estado];
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${clase}`}>
      {texto}
    </span>
  );
}

function Aviso({
  tono, icono, children,
}: {
  tono: "bien" | "ojo" | "malo";
  icono: React.ReactNode;
  children: React.ReactNode;
}) {
  const TONOS = {
    bien: "bg-emerald-50 text-emerald-900",
    ojo: "bg-amber-50 text-amber-900",
    malo: "bg-red-50 text-red-900",
  };
  return (
    <div className={`flex gap-2 rounded-lg p-2.5 ${TONOS[tono]}`}>
      <span className="mt-px shrink-0">{icono}</span>
      <p className="text-[0.6875rem] leading-relaxed">{children}</p>
    </div>
  );
}
