"use client";

import Link from "next/link";
import { PanelConsultor, type AccionesConsultor, type LigaConsultor } from "@/consultor/componentes/PanelConsultor";
import type { Memoria, MensajeConsultor, PasoPlan, R } from "@/consultor/tipos";
import { PERFIL } from "@/lib/consultor/perfil";

/**
 * El panel comun (consultor/) con las acciones de Maintrack: cada una es una
 * llamada a /api/consultor, que resuelve empresa y rol en el servidor.
 */
async function llamar<T>(cuerpo: Record<string, unknown>): Promise<R<T>> {
  const res = await fetch("/api/consultor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) });
  const datos = await res.json().catch(() => null);
  if (!res.ok || !datos) return { ok: false, error: (datos as { error?: string } | null)?.error ?? "No se pudo completar. Intente de nuevo." };
  return datos as R<T>;
}

const ACCIONES: AccionesConsultor = {
  preguntar: (texto, ruta) => llamar({ accion: "preguntar", texto, ruta }),
  guardarNota: (tipo, texto) => llamar({ accion: "nota", tipo, texto }),
  apagarNota: (id) => llamar({ accion: "apagarNota", id }),
  restaurarNota: (id) => llamar({ accion: "restaurarNota", id }),
  arrancar: (respuestas) => llamar({ accion: "arrancar", respuestas }),
  saltarEntrevista: () => llamar({ accion: "saltar" }),
};

const Liga: LigaConsultor = ({ href, className, children }) => <Link href={href} className={className}>{children}</Link>;

export function PanelDelConsultor(p: {
  pasos: PasoPlan[]; porcentaje: number; memoria: Memoria; mensajes: MensajeConsultor[]; quedanHoy: number;
  ia: { disponible: boolean; motivo: string }; puedeAdministrar: boolean; soloLectura: boolean; ahora: string;
}) {
  return <PanelConsultor {...p} perfil={PERFIL} acciones={ACCIONES} Liga={Liga} />;
}
