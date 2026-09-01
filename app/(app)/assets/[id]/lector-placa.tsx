"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, Loader2, RefreshCw } from "lucide-react";
import { Badge, Button, Card, CardHeader } from "@/components/ui";

type Lectura = {
  legible: boolean;
  calidad: "BUENA" | "REGULAR" | "MALA";
  problema: string;
  comoMejorarla: string;
  fabricante: string;
  modelo: string;
  serie: string;
  datosTecnicos: Array<{ dato: string; valor: string }>;
  nota: string;
};

/** 5 MB de foto: de sobra para una placa, y evita subidas de 20 MB del celular. */
const LIMITE_MB = 5;

/**
 * Captura de la placa de datos con la camara.
 *
 * Lo importante aqui no es leer bien —eso lo hace el modelo— sino manejar
 * decentemente el caso en que la foto NO sirve: decir que esta mal y que hacer
 * para repetirla. Una funcion de este tipo que solo falla en silencio se
 * abandona al segundo intento.
 */
export function LectorPlaca({
  assetId,
  nombreDelActivo,
  yaTieneDatos,
}: {
  assetId: string;
  nombreDelActivo: string;
  yaTieneDatos: boolean;
}) {
  const router = useRouter();
  const archivo = useRef<HTMLInputElement>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [lectura, setLectura] = useState<Lectura | null>(null);
  const [listo, setListo] = useState(false);

  async function alElegir(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;

    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) {
      setError("Use una foto en JPG, PNG o WEBP.");
      return;
    }
    if (f.size > LIMITE_MB * 1024 * 1024) {
      setError(`La foto pesa ${(f.size / 1024 / 1024).toFixed(1)} MB y el limite son ${LIMITE_MB} MB. Tomela con menor resolucion.`);
      return;
    }

    setError(null);
    setLectura(null);
    setListo(false);
    setVista(URL.createObjectURL(f));
    setLeyendo(true);

    const base64 = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result).split(",")[1] ?? "");
      lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
      lector.readAsDataURL(f);
    });

    const res = await fetch("/api/ia/placa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base64, tipo: f.type, contexto: nombreDelActivo }),
    });
    const data = await res.json();
    setLeyendo(false);
    if (!res.ok) { setError(data.error ?? "No fue posible leer la placa"); return; }
    setLectura(data.lectura);
  }

  async function guardar() {
    if (!lectura) return;
    setGuardando(true);
    setError(null);
    const tecnicos = lectura.datosTecnicos.map((d) => `${d.dato}: ${d.valor}`).join(" · ");
    const res = await fetch(`/api/assets/${assetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(lectura.fabricante ? { manufacturer: lectura.fabricante } : {}),
        ...(lectura.modelo ? { model: lectura.modelo } : {}),
        ...(lectura.serie ? { serialNumber: lectura.serie } : {}),
        ...(tecnicos ? { description: tecnicos } : {}),
      }),
    });
    setGuardando(false);
    if (!res.ok) {
      const d = await res.json();
      setError(d.error ?? "No fue posible guardar");
      return;
    }
    setListo(true);
    setLectura(null);
    setVista(null);
    router.refresh();
  }

  const hayAlgo = lectura && (lectura.fabricante || lectura.modelo || lectura.serie || lectura.datosTecnicos.length);

  return (
    <Card>
      <CardHeader
        title="Leer la placa con una foto"
        subtitle={
          yaTieneDatos
            ? "Este equipo ya tiene datos de placa. Una lectura nueva los reemplaza."
            : "Tome la foto de la placa metalica del equipo y se llenan marca, modelo y numero de serie."
        }
        action={<Camera className="h-4 w-4 text-slate-400" />}
      />

      {!lectura && !leyendo ? (
        <div className="rounded-lg border border-dashed border-slate-300 p-4">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-slate-500">Para que salga bien</p>
          <ul className="mt-1.5 grid gap-0.5 text-xs text-slate-600">
            <li>· Encuadre <strong>solo la placa</strong>, a medio metro o menos.</li>
            <li>· De frente, no en angulo: el texto en diagonal se lee mal.</li>
            <li>· Sin flash directo — rebota en el metal. Mejor luz de lado.</li>
            <li>· Si esta sucia o con grasa, limpiela antes con un trapo.</li>
          </ul>
          <Button size="sm" className="mt-3" onClick={() => archivo.current?.click()}>
            <Camera className="h-3.5 w-3.5" /> Tomar o subir la foto
          </Button>
        </div>
      ) : null}

      <input
        ref={archivo}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="hidden"
        onChange={alElegir}
      />

      {leyendo ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-4">
          <Loader2 className="h-4 w-4 animate-spin text-brand-500" />
          <p className="text-xs text-slate-600">Leyendo la placa…</p>
        </div>
      ) : null}

      {error ? <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      {listo ? <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Datos de placa guardados.</p> : null}

      {lectura ? (
        <div className="mt-2 grid gap-3">
          {vista ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={vista} alt="Placa fotografiada" className="max-h-40 w-full rounded-lg border border-slate-200 object-contain" />
          ) : null}

          {!lectura.legible || lectura.calidad === "MALA" ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
                <AlertTriangle className="h-4 w-4" /> La foto no permite leer la placa
              </p>
              {lectura.problema ? <p className="mt-1 text-xs text-amber-900">{lectura.problema}</p> : null}
              {lectura.comoMejorarla ? (
                <p className="mt-1.5 rounded-md bg-white/70 px-2 py-1.5 text-xs font-medium text-amber-950">
                  Que hacer: {lectura.comoMejorarla}
                </p>
              ) : null}
              <Button size="sm" variant="secondary" className="mt-2" onClick={() => archivo.current?.click()}>
                <RefreshCw className="h-3.5 w-3.5" /> Repetir la foto
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <Badge tone={lectura.calidad === "BUENA" ? "success" : "warning"}>
                  calidad {lectura.calidad.toLowerCase()}
                </Badge>
                {lectura.calidad === "REGULAR" && lectura.comoMejorarla ? (
                  <span className="text-[0.6875rem] text-amber-700">{lectura.comoMejorarla}</span>
                ) : null}
              </div>

              <dl className="grid gap-1.5 rounded-lg border border-slate-200 p-3 text-xs">
                <Dato etiqueta="Fabricante" valor={lectura.fabricante} />
                <Dato etiqueta="Modelo" valor={lectura.modelo} />
                <Dato etiqueta="Numero de serie" valor={lectura.serie} />
                {lectura.datosTecnicos.map((d) => <Dato key={d.dato} etiqueta={d.dato} valor={d.valor} />)}
              </dl>

              {lectura.nota ? <p className="text-[0.6875rem] text-slate-500">{lectura.nota}</p> : null}

              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="secondary" onClick={() => archivo.current?.click()}>
                  <RefreshCw className="h-3.5 w-3.5" /> Otra foto
                </Button>
                <Button size="sm" onClick={guardar} disabled={guardando || !hayAlgo}>
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Guardar en el activo
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-slate-500">{etiqueta}</dt>
      <dd className={valor ? "font-medium text-slate-800" : "text-slate-300"}>{valor || "no se leyo"}</dd>
    </div>
  );
}
