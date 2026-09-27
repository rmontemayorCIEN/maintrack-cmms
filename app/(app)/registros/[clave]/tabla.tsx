"use client";

import { TablaConfigurable, type Columna, type Vista } from "@/components/tabla-configurable";
import { esNumerico, definicionDeCampo } from "@/lib/registros-tipos";

/**
 * Lo capturado en una tabla propia, en la tabla configurable del sistema.
 *
 * Se reusa en vez de dibujar una tabla nueva: el filtro, la agrupacion, el
 * orden por encabezado, las columnas que se prenden y apagan y la vista
 * guardada por persona ya existen ahi, y una tabla propia no merece una version
 * peor de todo eso.
 *
 * Las columnas se derivan de los campos. Lo unico que hay que cuidar es el
 * ORDEN: el texto de una columna de dinero es «3,150.00» y ordenarlo como
 * palabra pone el 1,200 antes que el 900. Por eso las numericas y las de fecha
 * declaran `ordenPor` con su valor real.
 */

export type RenglonParaTabla = {
  id: string;
  folio: number;
  capturoNombre: string | null;
  creado: string;
  valores: Record<string, { texto: string; orden: string | number; perdida?: boolean }>;
};

export function TablaDeRegistros({
  clave,
  campos,
  renglones,
  total,
}: {
  clave: string;
  campos: Array<{ clave: string; etiqueta: string; tipo: string; enLista: boolean }>;
  renglones: RenglonParaTabla[];
  total: number;
}) {
  const pinta = (c: { clave: string }) => (f: RenglonParaTabla) => {
    const v = f.valores[c.clave];
    if (!v?.texto) return <span className="text-slate-300">—</span>;
    // Una referencia perdida NO se pinta como un guion: se dice, porque un dato
    // que desaparece sin avisar es el defecto que mas caro ha salido aqui.
    if (v.perdida) return <span className="text-amber-600" title="El registro al que apuntaba ya no existe">ya no existe</span>;
    return v.texto;
  };

  const deCampo = (campo: { clave: string; etiqueta: string; tipo: string }): Columna<RenglonParaTabla> => ({
    id: campo.clave,
    etiqueta: campo.etiqueta,
    // Se agrupa por lo que se repite: listas, si/no y las columnas que apuntan
    // a un catalogo. Agrupar por un importe o por una nota no dice nada.
    agrupable: campo.tipo === "LISTA" || campo.tipo === "SI_NO" || Boolean(definicionDeCampo(campo.tipo).llave),
    alineaDerecha: esNumerico(campo.tipo),
    texto: (f) => f.valores[campo.clave]?.texto ?? "",
    ordenPor: (f) => f.valores[campo.clave]?.orden ?? "",
    pinta: pinta(campo),
  });

  const fijas: Columna<RenglonParaTabla>[] = [
    {
      id: "folio", etiqueta: "N°", alineaDerecha: true,
      texto: (f) => String(f.folio),
      ordenPor: (f) => f.folio,
    },
  ];

  const columnas = campos.map(deCampo).concat([
    {
      id: "capturo", etiqueta: "Capturó", agrupable: true,
      texto: (f) => f.capturoNombre ?? "",
      pinta: (f) => f.capturoNombre ?? <span className="text-slate-300">—</span>,
    },
    { id: "creado", etiqueta: "Cuándo se capturó", texto: (f) => f.creado, ordenPor: (f) => f.creado },
  ]);

  // De fabrica, las que el cliente marco para la lista: una tabla de veinte
  // columnas no se lee en un telefono.
  const deFabrica = campos.filter((c) => c.enLista).map((c) => c.clave);
  const vistaInicial: Vista = { columnas: deFabrica, grupos: [], orden: null };

  return (
    <TablaConfigurable
      filas={renglones}
      fijas={fijas}
      columnas={columnas}
      deFabrica={deFabrica.length ? deFabrica : columnas.slice(0, 4).map((c) => c.id)}
      vistaInicial={vistaInicial}
      clave={`registros:${clave}`}
      total={total}
      sustantivo="renglones"
    />
  );
}
