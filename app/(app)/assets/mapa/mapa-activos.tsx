"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Map as MapaLeaflet, LayerGroup } from "leaflet";
import { ASSET_STATUS_LABELS } from "@/lib/constants";
import { formatCurrency, formatNumber } from "@/lib/utils";
import {
  CAPAS, ETIQUETA_DE_CAPA, MOSAICOS_ATRIBUCION, MOSAICOS_URL, PERIODOS_DIAS, PERIODO_POR_OMISION, TONOS, tonoDe,
  type Capa, type Limites, type RespuestaMapa,
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
  const filtrosRef = useRef({ siteId: "", categoryId: "", status: "", capa: "ESTADO" as Capa, dias: PERIODO_POR_OMISION as number });

  const [filtros, setFiltros] = useState(filtrosRef.current);
  const [resumen, setResumen] = useState<RespuestaMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [completa, setCompleta] = useState(false);

  /** La cifra de la capa, escrita como corresponde: pesos, horas o cuenta de fallas. */
  const cifra = (c: Capa, v: number) =>
    c === "COSTO" ? formatCurrency(v, moneda) : c === "PAROS" ? `${formatNumber(v, 1)} h` : formatNumber(v, 0);

  async function cargar() {
    const m = mapa.current, L = leaflet.current, grupo = capa.current;
    if (!m || !L || !grupo) return;
    const b = m.getBounds();
    const f = filtrosRef.current;
    const q = new URLSearchParams({
      // Una celda por ~72 px: el circulo mas grande (34 de radio) cabe en ella sin encimarse.
      columnas: String(Math.min(30, Math.max(3, Math.round(m.getSize().x / 72)))),
      filas: String(Math.min(30, Math.max(3, Math.round(m.getSize().y / 72)))),
      norte: String(b.getNorth()), sur: String(b.getSouth()), este: String(b.getEast()), oeste: String(b.getWest()),
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
      grupo.clearLayers();
      const porEstado = r.capa === "ESTADO";
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
      setResumen(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el mapa");
    } finally {
      setCargando(false);
    }
  }

  // El mapa se crea una vez. Leaflet toca `window`, por eso se importa aquí y no arriba.
  useEffect(() => {
    let vivo = true;
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      const L = (await import("leaflet")).default;
      if (!vivo || !contenedor.current || mapa.current) return;
      leaflet.current = L;
      const m = L.map(contenedor.current, { zoomControl: true });
      L.tileLayer(MOSAICOS_URL, { attribution: MOSAICOS_ATRIBUCION, maxZoom: 19 }).addTo(m);
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
      <div className={`w-full overflow-hidden rounded-xl border border-slate-200 ${completa ? "min-h-0 flex-1" : "h-[28rem] md:h-[34rem]"}`}>
        <div ref={contenedor} role="application" aria-label="Mapa de activos" className="h-full w-full" />
      </div>

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
