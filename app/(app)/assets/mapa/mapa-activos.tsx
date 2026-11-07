"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Map as MapaLeaflet, LayerGroup, TileLayer } from "leaflet";
import { ASSET_STATUS_LABELS } from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  CAPAS, ETIQUETA_DE_CAPA, ETIQUETA_DE_VISTA, FONDOS, PERIODOS_DIAS, PERIODO_POR_OMISION, TONOS, VISTAS, estadoMasGrave, tonoDe,
  type Capa, type FondoId, type Limites, type RespuestaMapa, type Vista,
} from "@/lib/mapa";

/** Variable de color (definida en globals.css, con su versión oscura) por estado. */
const COLOR_DE_ESTADO: Record<string, string> = {
  OPERATIONAL: "--mapa-operativo",
  DEGRADED: "--mapa-degradado",
  DOWN: "--mapa-fuera",
  STANDBY: "--mapa-reserva",
  RETIRED: "--mapa-reserva",
};
/** Los tonos de las capas numéricas: del 1 (poco) al 4 (lo más alto). El 0 es «sin nada». */
const variableDeTono = (tono: number) => (tono <= 0 ? "--mapa-reserva" : `--mapa-escala-${tono}`);

const color = (variable: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "currentColor";

type Opcion = { id: string; name: string };

/** Lo que se recuerda por persona (fondo y vista): una comodidad, nunca un dato que importe. */
const LLAVE_FONDO = "mapa-activos:fondo";
const LLAVE_VISTA = "mapa-activos:vista";
function recordado<T extends string>(llave: string, validos: readonly T[], porOmision: T): T {
  try {
    const v = window.localStorage.getItem(llave);
    return (validos as readonly string[]).includes(v ?? "") ? (v as T) : porOmision;
  } catch { return porOmision; }
}
function recordar(llave: string, valor: string) {
  try { window.localStorage.setItem(llave, valor); } catch { /* sin almacenamiento: no se recuerda y ya */ }
}

export function MapaActivos({
  sites, categories, conCoordenadas, sinCoordenadas, encuadre, puedeVerCostos, moneda,
}: {
  sites: Opcion[]; categories: Opcion[];
  conCoordenadas: number; sinCoordenadas: number;
  encuadre: Limites | null;
  puedeVerCostos: boolean; moneda: string;
}) {
  const raiz = useRef<HTMLDivElement>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLeaflet | null>(null);
  const capa = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const fondoCapa = useRef<TileLayer | null>(null);
  const ultima = useRef<RespuestaMapa | null>(null);
  const vistaRef = useRef<Vista>("PUNTOS");
  /** La zona que miraba el mapa. En «Lista» el mapa está escondido y no sabe medirse: se usa la última real. */
  const zonaRef = useRef<Limites | null>(null);
  const fondoRef = useRef<FondoId>("calles");
  const filtrosRef = useRef({ siteId: "", categoryId: "", status: "", capa: "ESTADO" as Capa, dias: PERIODO_POR_OMISION as number });

  const [filtros, setFiltros] = useState(filtrosRef.current);
  const [resumen, setResumen] = useState<RespuestaMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [completa, setCompleta] = useState(false);
  const [vista, setVista] = useState<Vista>("PUNTOS");
  const [fondo, setFondo] = useState<FondoId>("calles");
  const [orden, setOrden] = useState<"valor" | "code" | "status">("valor");

  /** La cifra de la capa, escrita como corresponde: pesos, horas o cuenta de fallas. */
  const cifra = (c: Capa, v: number) =>
    c === "COSTO" ? formatCurrency(v, moneda) : c === "PAROS" ? `${formatNumber(v, 1)} h` : formatNumber(v, 0);

  /** Pinta la última respuesta según la vista elegida. Cambiar de vista no vuelve a pedir nada. */
  function dibujar(r: RespuestaMapa) {
    const m = mapa.current, L = leaflet.current, grupo = capa.current;
    if (!m || !L || !grupo) return;
    grupo.clearLayers();
    const v = vistaRef.current;
    if (v === "LISTA") return; // la lista se arma en React; el mapa queda quieto
    const porEstado = r.capa === "ESTADO";
    if (v === "CALOR") { dibujarCalor(r, L, grupo); return; }
    if (v === "CIRCUITO") dibujarCircuitos(r, L, grupo);
    {
      for (const p of r.puntos) {
        const tono = tonoDe(p.valor, r.maximo);
        const c = color(porEstado ? (COLOR_DE_ESTADO[p.status] ?? "--mapa-reserva") : variableDeTono(tono));
        // En las capas numéricas el tamaño también sube con el tono: el color solo no basta para todos los ojos.
        const radio = porEstado ? 7 : 5 + tono * 1.5;
        const punto = L.circleMarker([p.latitud, p.longitud], { radius: radio, color: c, fillColor: c, fillOpacity: 0.85, weight: 2 });
        // El nombre lo escribe el cliente: se pone como texto, nunca como HTML.
        const caja = document.createElement("div");
        const titulo = document.createElement("strong");
        titulo.textContent = `${p.code} — ${p.name}`;
        const estado = document.createElement("div");
        estado.textContent = ASSET_STATUS_LABELS[p.status] ?? p.status;
        caja.append(titulo, estado);
        if (p.motivo) {
          const motivo = document.createElement("div");
          motivo.textContent = p.motivo;
          motivo.style.opacity = "0.8";
          caja.append(motivo);
        }
        if (!porEstado) {
          const linea = document.createElement("div");
          linea.textContent = `${ETIQUETA_DE_CAPA[r.capa]} (${r.dias} días): ${cifra(r.capa, p.valor)}`;
          caja.append(linea);
        }
        const enlace = document.createElement("a");
        enlace.href = `/assets/${p.id}`;
        enlace.textContent = "Abrir ficha";
        enlace.style.display = "inline-block";
        enlace.style.marginTop = "4px";
        enlace.style.textDecoration = "underline";
        caja.append(enlace);
        punto.bindPopup(caja);
        punto.addTo(grupo);
      }
      for (const g of r.grupos) {
        // Relleno neutro y aro con lo más grave del grupo (el estado peor, o el tono más alto):
        // con una sola luminaria apagada entre cientos, un círculo entero en rojo dejaría el mapa
        // todo rojo y sin decir nada.
        const aro = color(porEstado ? (COLOR_DE_ESTADO[g.peor] ?? "--mapa-reserva") : variableDeTono(tonoDe(g.maxValor, r.maximo)));
        const radio = Math.min(34, 12 + Math.log10(g.cantidad) * 7);
        const circulo = L.circleMarker([g.latitud, g.longitud], { radius: radio, color: aro, fillColor: color("--mapa-grupo"), fillOpacity: 0.85, weight: 4 });
        circulo.bindTooltip(String(g.cantidad), { permanent: true, direction: "center", className: "mapa-grupo" });
        circulo.on("click", () => m.setView([g.latitud, g.longitud], Math.min(m.getZoom() + 2, 19)));
        circulo.addTo(grupo);
      }
    }
  }

  /**
   * Calor sin librería: cada equipo con algo que mostrar es un halo de tres círculos
   * translúcidos; donde se encimaran, la mancha se carga. En estado pesa lo grave
   * (fuera de servicio más que degradado); en las demás capas, el valor sobre el máximo.
   */
  function dibujarCalor(r: RespuestaMapa, L: typeof import("leaflet"), grupo: LayerGroup) {
    const porEstado = r.capa === "ESTADO";
    const halos: Array<{ lat: number; lon: number; peso: number; estado: string }> = [];
    if (r.modo === "puntos") {
      for (const p of r.puntos) {
        const peso = porEstado ? (p.status === "DOWN" ? 1 : p.status === "DEGRADED" ? 0.55 : 0) : (r.maximo > 0 ? p.valor / r.maximo : 0);
        if (peso > 0) halos.push({ lat: p.latitud, lon: p.longitud, peso, estado: p.status });
      }
    } else {
      for (const g of r.grupos) {
        const peso = porEstado ? (g.peor === "DOWN" ? 1 : g.peor === "DEGRADED" ? 0.55 : 0) : (r.maximo > 0 ? g.maxValor / r.maximo : 0);
        if (peso > 0) halos.push({ lat: g.latitud, lon: g.longitud, peso, estado: g.peor });
      }
    }
    for (const h of halos) {
      const c = color(porEstado ? (COLOR_DE_ESTADO[h.estado] ?? "--mapa-reserva") : "--mapa-escala-3");
      for (const [radio, opacidad] of [[34, 0.07], [22, 0.12], [11, 0.2]] as const) {
        L.circleMarker([h.lat, h.lon], { radius: radio, stroke: false, fillColor: c, fillOpacity: Math.min(0.9, opacidad * (0.5 + h.peso)), interactive: false }).addTo(grupo);
      }
    }
  }

  /** Une con una línea a los equipos que cuelgan del mismo padre, en orden de código. */
  function dibujarCircuitos(r: RespuestaMapa, L: typeof import("leaflet"), grupo: LayerGroup) {
    const porPadre = new Map<string, typeof r.puntos>();
    for (const p of r.puntos) if (p.padreId) porPadre.set(p.padreId, [...(porPadre.get(p.padreId) ?? []), p]);
    for (const miembros of porPadre.values()) {
      if (miembros.length < 2) continue;
      const linea = L.polyline(miembros.map((p) => [p.latitud, p.longitud] as [number, number]), { color: color("--mapa-grupo"), weight: 3, opacity: 0.55, dashArray: "6 6" });
      linea.bindTooltip(`${miembros[0].padreNombre ?? "Circuito"} · ${miembros.length} equipos`, { sticky: true });
      linea.addTo(grupo);
    }
  }

  async function cargar() {
    const m = mapa.current, L = leaflet.current, grupo = capa.current;
    if (!m || !L || !grupo) return;
    const f = filtrosRef.current;
    if (vistaRef.current !== "LISTA" || !zonaRef.current) {
      const b = m.getBounds();
      // Escondido (o aún sin medir) el mapa devuelve una zona sin sentido: ahí manda el encuadre de todo lo ubicado.
      const medido = vistaRef.current !== "LISTA" && m.getSize().x > 0;
      zonaRef.current = medido ? { norte: b.getNorth(), sur: b.getSouth(), este: b.getEast(), oeste: b.getWest() }
        : encuadre ?? { norte: 33, sur: 14, este: -86, oeste: -119 };
    }
    const z = zonaRef.current;
    const q = new URLSearchParams({
      // Una celda por ~72 px: el circulo mas grande (34 de radio) cabe en ella sin encimarse.
      columnas: String(Math.min(30, Math.max(3, Math.round(m.getSize().x / 72)))),
      filas: String(Math.min(30, Math.max(3, Math.round(m.getSize().y / 72)))),
      norte: String(z.norte), sur: String(z.sur), este: String(z.este), oeste: String(z.oeste),
      capa: f.capa, dias: String(f.dias),
      ...(f.siteId ? { siteId: f.siteId } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.status ? { status: f.status } : {}),
    });
    setCargando(true);
    setError(null);
    try {
      const res = await fetch(`/api/assets/mapa?${q}`);
      const datos = await res.json();
      if (!res.ok) throw new Error(datos.error ?? "No se pudo cargar el mapa");
      const r: RespuestaMapa = datos.data ?? datos;
      ultima.current = r;
      dibujar(r);
      setResumen(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mapa");
    } finally {
      setCargando(false);
    }
  }

  // Lo que esta persona eligió la última vez. Se lee antes de crear el mapa para no pintar dos veces.
  useEffect(() => {
    const f = recordado<FondoId>(LLAVE_FONDO, FONDOS.map((x) => x.id as FondoId), "calles");
    const v = recordado<Vista>(LLAVE_VISTA, VISTAS, "PUNTOS");
    fondoRef.current = f; vistaRef.current = v;
    setFondo(f); setVista(v);
  }, []);

  // El mapa se crea una vez. Leaflet toca `window`, por eso se importa aquí y no arriba.
  useEffect(() => {
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!vivo || !contenedor.current || mapa.current) return;
      leaflet.current = L;
      const m = L.map(contenedor.current, { zoomControl: true });
      const inicial = FONDOS.find((f) => f.id === fondoRef.current) ?? FONDOS[0];
      fondoCapa.current = L.tileLayer(inicial.url, { attribution: inicial.atribucion, maxZoom: 19, subdomains: inicial.subdominios }).addTo(m);
      capa.current = L.layerGroup().addTo(m);
      mapa.current = m;
      if (encuadre) {
        const { sur, oeste, norte, este } = encuadre;
        // Un solo punto da un rectángulo de área cero: se acerca a la calle en vez de al mundo.
        if (sur === norte && oeste === este) m.setView([sur, oeste], 17);
        else m.fitBounds([[sur, oeste], [norte, este]], { padding: [30, 30] });
      } else {
        m.setView([23.6, -102.5], 5); // México, sin nada ubicado todavía
      }
      // El contenedor de las teselas no existe hasta que el mapa tiene vista: el filtro del fondo se pone ahora.
      const contFondo = fondoCapa.current?.getContainer();
      if (contFondo) contFondo.style.filter = inicial.filtro;
      // Una carga por movimiento terminado, no una por cada pixel arrastrado.
      m.on("moveend", () => { clearTimeout(temporizador); temporizador = setTimeout(cargar, 250); });
      cargar();
    })();
    return () => {
      vivo = false;
      clearTimeout(temporizador);
      mapa.current?.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Pantalla completa. Se pide la nativa del navegador (que ya sale con Esc), y
   * además la capa fija sobre toda la ventana: el iPhone no deja poner un
   * elemento en pantalla completa nativa, y ahí solo queda la capa.
   * `requestFullscreen` tiene que salir del toque mismo, no de un efecto.
   */
  function entrar() {
    setCompleta(true);
    raiz.current?.requestFullscreen?.().catch(() => { /* sin pantalla nativa: queda la capa */ });
  }
  function salir() {
    setCompleta(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
  }

  useEffect(() => {
    if (!completa) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") salir(); };
    // En pantalla nativa, Esc lo consume el navegador y solo avisa con este evento.
    const alCambiar = () => { if (!document.fullscreenElement) setCompleta(false); };
    window.addEventListener("keydown", alTeclear);
    document.addEventListener("fullscreenchange", alCambiar);
    const desborde = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // la página de atrás no se desplaza mientras tanto
    return () => {
      window.removeEventListener("keydown", alTeclear);
      document.removeEventListener("fullscreenchange", alCambiar);
      document.body.style.overflow = desborde;
    };
  }, [completa]);

  // Al cambiar de tamaño, Leaflet tiene que enterarse; y la zona visible cambió, así que se vuelve a pedir.
  useEffect(() => {
    const t = setTimeout(() => { mapa.current?.invalidateSize(); cargar(); }, 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completa]);

  function cambiarFondo(id: FondoId) {
    const f = FONDOS.find((x) => x.id === id);
    const m = mapa.current, L = leaflet.current;
    if (!f || !m || !L) return;
    fondoCapa.current?.remove();
    fondoCapa.current = L.tileLayer(f.url, { attribution: f.atribucion, maxZoom: 19, subdomains: f.subdominios }).addTo(m);
    fondoCapa.current.bringToBack();
    const cont = fondoCapa.current.getContainer();
    if (cont) cont.style.filter = f.filtro;
    fondoRef.current = id; setFondo(id); recordar(LLAVE_FONDO, id);
  }

  function cambiarVista(v: Vista) {
    vistaRef.current = v; setVista(v); recordar(LLAVE_VISTA, v);
    // Al volver de la lista, la zona se vuelve a medir del mapa; al irse, se conserva la que había.
    if (v !== "LISTA") zonaRef.current = null;
    if (ultima.current) dibujar(ultima.current);
    // El mapa estuvo escondido en «Lista»: Leaflet tiene que volver a medir su caja.
    setTimeout(() => { mapa.current?.invalidateSize(); if (v !== "LISTA") cargar(); }, 50);
  }

  /** Acerca el mapa a un grupo de equipos (un circuito de la tabla). */
  function acercarA(puntos: Array<{ latitud: number; longitud: number }>) {
    if (!mapa.current || !puntos.length) return;
    mapa.current.fitBounds(puntos.map((p) => [p.latitud, p.longitud] as [number, number]), { padding: [40, 40], maxZoom: 18 });
  }

  function cambiar(campo: keyof typeof filtros, valor: string | number) {
    const nuevos = { ...filtros, [campo]: valor };
    setFiltros(nuevos);
    filtrosRef.current = nuevos;
    cargar();
  }

  const sinNada = conCoordenadas === 0;
  const capas = CAPAS.filter((c) => c !== "COSTO" || puedeVerCostos);
  const numerica = filtros.capa !== "ESTADO";
  // Los cortes de la leyenda: cuartos del máximo de la empresa, igual que los tonos del mapa.
  const cortes: Array<{ tono: number; texto: string }> = [];
  if (resumen && numerica && resumen.maximo > 0) {
    for (let t = 1; t <= TONOS; t++) {
      const hasta = (resumen.maximo * t) / TONOS;
      const desde = (resumen.maximo * (t - 1)) / TONOS;
      if (filtros.capa === "FALLAS") {
        // Un conteo son enteros: el tono t cubre de floor(desde)+1 a floor(hasta). Si no cabe ninguno, no se anota.
        const a = Math.floor(desde) + 1, b = Math.floor(hasta);
        if (a > b) continue;
        cortes.push({ tono: t, texto: a === b ? `${a}` : `${a} – ${b}` });
      } else {
        cortes.push({ tono: t, texto: `${cifra(filtros.capa, desde)} – ${cifra(filtros.capa, hasta)}` });
      }
    }
  }

  return (
    <div
      ref={raiz}
      className={completa ? "fixed inset-0 z-[70] flex flex-col gap-2 bg-white p-3" : "space-y-3"}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[9rem] flex-1 text-xs">
          <span className="label">Colorear por</span>
          <select className="field" value={filtros.capa} onChange={(e) => cambiar("capa", e.target.value)}>
            {capas.map((c) => <option key={c} value={c}>{ETIQUETA_DE_CAPA[c]}</option>)}
          </select>
        </label>
        {numerica ? (
          <label className="min-w-[7rem] text-xs">
            <span className="label">Período</span>
            <select className="field" value={filtros.dias} onChange={(e) => cambiar("dias", Number(e.target.value))}>
              {PERIODOS_DIAS.map((d) => <option key={d} value={d}>Últimos {d} días</option>)}
            </select>
          </label>
        ) : null}
        <label className="min-w-[9rem] flex-1 text-xs">
          <span className="label">Sitio</span>
          <select className="field" value={filtros.siteId} onChange={(e) => cambiar("siteId", e.target.value)}>
            <option value="">Todos</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="min-w-[9rem] flex-1 text-xs">
          <span className="label">Categoría</span>
          <select className="field" value={filtros.categoryId} onChange={(e) => cambiar("categoryId", e.target.value)}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="min-w-[9rem] flex-1 text-xs">
          <span className="label">Estado</span>
          <select className="field" value={filtros.status} onChange={(e) => cambiar("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="min-w-[8rem] text-xs">
          <span className="label">Ver como</span>
          <select className="field" value={vista} onChange={(e) => cambiarVista(e.target.value as Vista)}>
            {VISTAS.map((v) => <option key={v} value={v}>{ETIQUETA_DE_VISTA[v]}</option>)}
          </select>
        </label>
        <label className="min-w-[7rem] text-xs">
          <span className="label">Fondo</span>
          <select className="field" value={fondo} onChange={(e) => cambiarFondo(e.target.value as FondoId)} disabled={vista === "LISTA"}>
            {FONDOS.map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={completa ? salir : entrar}
          aria-pressed={completa}
          title={completa ? "Volver a la vista normal (Esc)" : "Ver el mapa en pantalla completa"}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {completa ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          {completa ? "Salir (Esc)" : "Pantalla completa"}
        </button>
      </div>

      {sinNada ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Ningún activo tiene coordenadas todavía. Se capturan en la ficha del activo («Editar activo») o se traen
          juntas con la importación, con las columnas <strong>latitud</strong> y <strong>longitud</strong>.
        </div>
      ) : null}

      {/*
        * El tamaño vive en esta caja y NO en el contenedor del mapa: Leaflet le pone sus
        * propias clases (`leaflet-container`…) y, si React reescribe el `class` del
        * contenedor al cambiar de tamaño, se las borra y las teselas colapsan a ancho 0.
        */}
      <div className={`w-full overflow-hidden rounded-xl border border-slate-200 ${vista === "LISTA" ? "hidden" : completa ? "min-h-0 flex-1" : "h-[28rem] md:h-[34rem]"}`}>
        <div ref={contenedor} role="application" aria-label="Mapa de activos" className="h-full w-full" />
      </div>

      {vista === "LISTA" ? <ListaDeEquipos resumen={resumen} orden={orden} setOrden={setOrden} cifra={cifra} completa={completa} /> : null}
      {vista === "CIRCUITO" ? <ResumenDeCircuitos resumen={resumen} cifra={cifra} acercarA={acercarA} /> : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {(numerica
          ? [["--mapa-reserva", "Sin nada"], ...cortes.map((c) => [variableDeTono(c.tono), c.texto])]
          : [["--mapa-operativo", "Operativo"], ["--mapa-degradado", "Degradado"], ["--mapa-fuera", "Fuera de servicio"], ["--mapa-reserva", "En reserva o retirado"]]
        ).map(([v, t]) => (
          <span key={v + t} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${v})` }} /> {t}
          </span>
        ))}
        <span className="ml-auto" aria-live="polite">
          {error ? <span className="text-red-600">{error}</span>
            : cargando ? "Cargando…"
            : resumen ? (
              <>
                {resumen.modo === "grupos"
                  ? `${formatNumber(resumen.total, 0)} activos en esta zona, agrupados${resumen.incompleto ? " (muestra: hay más de los que se leen de una vez)" : ""}. Acérquese para verlos uno por uno.`
                  : `${formatNumber(resumen.total, 0)} activo${resumen.total === 1 ? "" : "s"} en esta zona.`}
                {numerica ? ` ${ETIQUETA_DE_CAPA[resumen.capa]} en la zona (últimos ${resumen.dias} días): ${cifra(resumen.capa, resumen.suma)}.` : ""}
              </>
            ) : null}
        </span>
      </div>

      {numerica ? (
        <p className="text-[0.6875rem] leading-relaxed text-slate-500">
          {filtros.capa === "FALLAS" ? "Cuenta las órdenes que son falla con el mismo criterio de los demás indicadores. " : ""}
          {filtros.capa === "PAROS" ? "Suma los paros no planeados que empezaron en el período, según los minutos registrados. " : ""}
          {filtros.capa === "COSTO" ? "Suma el costo de las órdenes del período, sin las canceladas. " : ""}
          Los tonos van de menos a más sobre el valor más alto de toda la empresa, así que no cambian al mover el mapa.
        </p>
      ) : (
        <p className="text-[0.6875rem] leading-relaxed text-slate-500">
          El color es el estado de este momento: el más grave entre el que está registrado y lo que pasa ahora (un paro abierto
          lo marca fuera de servicio; una orden de falla abierta, degradado).
        </p>
      )}

      {vista === "CALOR" ? (
        <p className="text-[0.6875rem] leading-relaxed text-slate-500">
          Las manchas se cargan donde hay más de lo que colorea el mapa (en estado, lo fuera de servicio pesa más que lo degradado). Es para ver zonas;
          para abrir un equipo use la vista de puntos o la lista.
        </p>
      ) : null}
      {vista === "CIRCUITO" ? (
        <p className="text-[0.6875rem] leading-relaxed text-slate-500">
          La línea punteada une los equipos que cuelgan del mismo circuito (su equipo padre en el catálogo). Tocar un renglón acerca el mapa a ese circuito.
        </p>
      ) : null}

      {sinCoordenadas > 0 ? (
        <p className="text-xs text-slate-500">
          {formatNumber(sinCoordenadas, 0)} activo{sinCoordenadas === 1 ? "" : "s"} sin coordenadas no se
          muestra{sinCoordenadas === 1 ? "" : "n"} aquí. {" "}
          <Link href="/assets" className="underline">Ver el catálogo</Link>
        </p>
      ) : null}
    </div>
  );
}

const MAXIMO_EN_LISTA = 300;
const PESO_ESTADO: Record<string, number> = { DOWN: 0, DEGRADED: 1, OPERATIONAL: 2, STANDBY: 3, RETIRED: 4 };

/** Los mismos equipos y filtros del mapa, en tabla. Con demasiados, pide acercar o filtrar: no se lista una muestra a escondidas. */
function ListaDeEquipos({ resumen, orden, setOrden, cifra, completa }: {
  resumen: RespuestaMapa | null; orden: "valor" | "code" | "status";
  setOrden: (o: "valor" | "code" | "status") => void; cifra: (c: Capa, v: number) => string; completa: boolean;
}) {
  if (!resumen) return null;
  if (resumen.modo === "grupos") {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
        Hay {formatNumber(resumen.total, 0)} activos en la zona: demasiados para una lista. Cambie a otra vista y acérquese,
        o filtre por sitio, categoría o estado.
      </p>
    );
  }
  const numerica = resumen.capa !== "ESTADO";
  const filas = [...resumen.puntos].sort((a, b) =>
    orden === "valor" && numerica ? b.valor - a.valor || a.code.localeCompare(b.code)
    : orden === "status" || (orden === "valor" && !numerica) ? (PESO_ESTADO[a.status] ?? 9) - (PESO_ESTADO[b.status] ?? 9) || a.code.localeCompare(b.code)
    : a.code.localeCompare(b.code));
  const visibles = filas.slice(0, MAXIMO_EN_LISTA);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Ordenar por</span>
        {(numerica
          ? ([["valor", ETIQUETA_DE_CAPA[resumen.capa]], ["status", "Estado"], ["code", "Código"]] as const)
          : ([["valor", "Estado"], ["code", "Código"]] as const))
          .map(([id, texto]) => (
            <button key={id} type="button" onClick={() => setOrden(id)} aria-pressed={orden === id}
              className={`rounded-full border px-2.5 py-1 ${orden === id ? "border-slate-700 bg-slate-100 font-medium text-slate-900" : "border-slate-200 bg-white hover:bg-slate-50"}`}>
              {texto}
            </button>
          ))}
      </div>
      <div className={`overflow-auto rounded-xl border border-slate-200 ${completa ? "max-h-[70vh]" : "max-h-[34rem]"}`}>
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-3 py-2 font-medium">Código</th>
              <th className="px-3 py-2 font-medium">Nombre</th>
              <th className="px-3 py-2 font-medium">Circuito</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              {numerica ? <th className="px-3 py-2 text-right font-medium">{ETIQUETA_DE_CAPA[resumen.capa]} ({resumen.dias} d)</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibles.map((p) => (
              <tr key={p.id}>
                <td className="whitespace-nowrap px-3 py-1.5 font-medium"><Link href={`/assets/${p.id}`} className="underline">{p.code}</Link></td>
                <td className="px-3 py-1.5">{p.name}</td>
                <td className="px-3 py-1.5 text-slate-600">{p.padreNombre ?? "—"}</td>
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${COLOR_DE_ESTADO[p.status] ?? "--mapa-reserva"})` }} />
                    {ASSET_STATUS_LABELS[p.status] ?? p.status}
                  </span>
                  {p.motivo ? <div className="text-xs text-slate-500">{p.motivo}</div> : null}
                </td>
                {numerica ? <td className="px-3 py-1.5 text-right tabular-nums">{p.valor > 0 ? cifra(resumen.capa, p.valor) : "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filas.length > MAXIMO_EN_LISTA ? (
        <p className="text-xs text-slate-500">Se muestran los primeros {MAXIMO_EN_LISTA} de {formatNumber(filas.length, 0)}. Filtre para ver el resto.</p>
      ) : null}
    </div>
  );
}

/** Un renglón por circuito (el equipo padre): cuántos equipos, el peor estado y la cifra de la capa. Tocarlo acerca el mapa. */
function ResumenDeCircuitos({ resumen, cifra, acercarA }: {
  resumen: RespuestaMapa | null; cifra: (c: Capa, v: number) => string;
  acercarA: (p: Array<{ latitud: number; longitud: number }>) => void;
}) {
  if (!resumen) return null;
  if (resumen.modo === "grupos") {
    return <p className="text-xs text-slate-500">Con tantos equipos en la zona no se pueden unir por circuito: acérquese o filtre.</p>;
  }
  const numerica = resumen.capa !== "ESTADO";
  const grupos = new Map<string, { nombre: string; puntos: typeof resumen.puntos }>();
  for (const p of resumen.puntos) {
    const clave = p.padreId ?? "—";
    const g = grupos.get(clave) ?? { nombre: p.padreNombre ?? "Sin equipo padre", puntos: [] };
    g.puntos.push(p);
    grupos.set(clave, g);
  }
  const filas = [...grupos.values()].map((g) => ({
    ...g,
    peor: g.puntos.reduce((e, p) => estadoMasGrave(e, p.status), "RETIRED"),
    suma: g.puntos.reduce((s, p) => s + p.valor, 0),
    fuera: g.puntos.filter((p) => p.status === "DOWN").length,
    degradados: g.puntos.filter((p) => p.status === "DEGRADED").length,
  })).sort((a, b) => numerica ? b.suma - a.suma : (PESO_ESTADO[a.peor] ?? 9) - (PESO_ESTADO[b.peor] ?? 9) || b.fuera - a.fuera || a.nombre.localeCompare(b.nombre));
  if (filas.length === 0) return null;
  return (
    <div className="overflow-auto rounded-xl border border-slate-200 max-h-64">
      <table className="w-full min-w-[30rem] text-left text-sm">
        <thead className="sticky top-0 bg-slate-50 text-xs text-slate-600">
          <tr>
            <th className="px-3 py-2 font-medium">Circuito</th>
            <th className="px-3 py-2 text-right font-medium">Equipos</th>
            <th className="px-3 py-2 text-right font-medium">Fuera de servicio</th>
            <th className="px-3 py-2 text-right font-medium">Degradados</th>
            {numerica ? <th className="px-3 py-2 text-right font-medium">{ETIQUETA_DE_CAPA[resumen.capa]} ({resumen.dias} d)</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {filas.map((g) => (
            <tr key={g.nombre} className="cursor-pointer hover:bg-slate-50" onClick={() => acercarA(g.puntos)}>
              <td className="px-3 py-1.5 font-medium">
                <button type="button" className="text-left underline" onClick={(e) => { e.stopPropagation(); acercarA(g.puntos); }}>{g.nombre}</button>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{formatNumber(g.puntos.length, 0)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{g.fuera || "—"}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{g.degradados || "—"}</td>
              {numerica ? <td className="px-3 py-1.5 text-right tabular-nums">{g.suma > 0 ? cifra(resumen.capa, g.suma) : "—"}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
