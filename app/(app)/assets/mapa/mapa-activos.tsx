"use client";

import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Map as MapaLeaflet, LayerGroup } from "leaflet";
import { ASSET_STATUS_LABELS } from "@/lib/constants";
import { formatNumber } from "@/lib/utils";
import { MOSAICOS_ATRIBUCION, MOSAICOS_URL, type Limites, type RespuestaMapa } from "@/lib/mapa";

/** Variable de color (definida en globals.css, con su versión oscura) por estado. */
const COLOR_DE_ESTADO: Record<string, string> = {
  OPERATIONAL: "--mapa-operativo",
  DEGRADED: "--mapa-degradado",
  DOWN: "--mapa-fuera",
  STANDBY: "--mapa-reserva",
  RETIRED: "--mapa-reserva",
};

const color = (variable: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || "currentColor";

type Opcion = { id: string; name: string };

export function MapaActivos({
  sites, categories, conCoordenadas, sinCoordenadas, encuadre,
}: {
  sites: Opcion[]; categories: Opcion[];
  conCoordenadas: number; sinCoordenadas: number;
  encuadre: Limites | null;
}) {
  const contenedor = useRef<HTMLDivElement>(null);
  const mapa = useRef<MapaLeaflet | null>(null);
  const capa = useRef<LayerGroup | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const filtrosRef = useRef({ siteId: "", categoryId: "", status: "" });

  const [filtros, setFiltros] = useState({ siteId: "", categoryId: "", status: "" });
  const [resumen, setResumen] = useState<RespuestaMapa | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

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
      for (const p of r.puntos) {
        const c = color(COLOR_DE_ESTADO[p.status] ?? "--mapa-reserva");
        const punto = L.circleMarker([p.latitud, p.longitud], { radius: 7, color: c, fillColor: c, fillOpacity: 0.85, weight: 2 });
        // El nombre lo escribe el cliente: se pone como texto, nunca como HTML.
        const caja = document.createElement("div");
        const titulo = document.createElement("strong");
        titulo.textContent = `${p.code} — ${p.name}`;
        const estado = document.createElement("div");
        estado.textContent = ASSET_STATUS_LABELS[p.status] ?? p.status;
        const enlace = document.createElement("a");
        enlace.href = `/assets/${p.id}`;
        enlace.textContent = "Abrir ficha";
        enlace.style.display = "inline-block";
        enlace.style.marginTop = "4px";
        enlace.style.textDecoration = "underline";
        caja.append(titulo, estado, enlace);
        punto.bindPopup(caja);
        punto.addTo(grupo);
      }
      for (const g of r.grupos) {
        // Relleno neutro y aro con el estado más grave: con una sola luminaria
        // apagada entre cientos, un círculo entero en rojo dejaría el mapa
        // todo rojo y sin decir nada.
        const aro = color(COLOR_DE_ESTADO[g.peor] ?? "--mapa-reserva");
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

  function cambiar(campo: keyof typeof filtros, valor: string) {
    const nuevos = { ...filtros, [campo]: valor };
    setFiltros(nuevos);
    filtrosRef.current = nuevos;
    cargar();
  }

  const sinNada = conCoordenadas === 0;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs">
          <span className="label">Sitio</span>
          <select className="field" value={filtros.siteId} onChange={(e) => cambiar("siteId", e.target.value)}>
            <option value="">Todos</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="label">Categoría</span>
          <select className="field" value={filtros.categoryId} onChange={(e) => cambiar("categoryId", e.target.value)}>
            <option value="">Todas</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="text-xs">
          <span className="label">Estado</span>
          <select className="field" value={filtros.status} onChange={(e) => cambiar("status", e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(ASSET_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>

      {sinNada ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          Ningún activo tiene coordenadas todavía. Se capturan en la ficha del activo («Editar activo») o se traen
          juntas con la importación, con las columnas <strong>latitud</strong> y <strong>longitud</strong>.
        </div>
      ) : null}

      <div
        ref={contenedor}
        role="application"
        aria-label="Mapa de activos"
        className="h-[28rem] w-full overflow-hidden rounded-xl border border-slate-200 md:h-[34rem]"
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
        {[["--mapa-operativo", "Operativo"], ["--mapa-degradado", "Degradado"], ["--mapa-fuera", "Fuera de servicio"], ["--mapa-reserva", "En reserva o retirado"]].map(([v, t]) => (
          <span key={v} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(${v})` }} /> {t}
          </span>
        ))}
        <span className="ml-auto" aria-live="polite">
          {error ? <span className="text-red-600">{error}</span>
            : cargando ? "Cargando…"
            : resumen ? (
              resumen.modo === "grupos"
                ? `${formatNumber(resumen.total, 0)} activos en esta zona, agrupados${resumen.incompleto ? " (muestra: hay más de los que se leen de una vez)" : ""}. Acérquese para verlos uno por uno.`
                : `${formatNumber(resumen.total, 0)} activo${resumen.total === 1 ? "" : "s"} en esta zona.`
            ) : null}
        </span>
      </div>

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
