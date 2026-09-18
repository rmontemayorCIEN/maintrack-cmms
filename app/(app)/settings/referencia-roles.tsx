"use client";

import { useState } from "react";
import { Check, Minus, ShieldQuestion } from "lucide-react";
import { ACCIONES_POR_ROL, ROLES_DEL_SISTEMA, rolesQuePueden } from "@/lib/matriz-roles";
import { ROLE_LABELS } from "@/lib/constants";

/**
 * Qué puede hacer cada rol, a la vista de quien da de alta a una persona.
 *
 * Sale de la misma matriz que aplica el servidor: si mañana cambia un permiso,
 * esta tabla cambia con él. No es un editor —los permisos no se configuran por
 * cliente— sino la respuesta a «¿con qué rol lo doy de alta?».
 */
export function ReferenciaDeRoles() {
  const [abierta, setAbierta] = useState(false);
  const grupos = [...new Set(ACCIONES_POR_ROL.map((a) => a.grupo))];

  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        <ShieldQuestion className="h-4 w-4 text-slate-400" />
        <span className="text-xs font-semibold text-slate-800">Qué puede hacer cada rol</span>
        <span className="ml-auto text-[0.6875rem] text-slate-500">{abierta ? "Ocultar" : "Ver tabla"}</span>
      </button>

      {abierta ? (
        <div className="border-t border-slate-200 px-4 py-3">
          <p className="mb-3 text-[0.6875rem] leading-relaxed text-slate-500">
            Es lo que el servidor aplica de verdad: aunque una pantalla ofreciera un botón, la
            acción se rechaza si el rol no la tiene. <strong className="text-slate-700">Consulta</strong> no
            tiene ninguna: es de solo lectura por construcción.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-[0.6875rem]">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-1.5 pr-3 font-medium">Acción</th>
                  {ROLES_DEL_SISTEMA.map((rol) => (
                    <th key={rol} className="px-2 py-1.5 text-center font-medium">{ROLE_LABELS[rol] ?? rol}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grupos.map((grupo) => (
                  <>
                    <tr key={grupo} className="bg-slate-50">
                      <td colSpan={ROLES_DEL_SISTEMA.length + 1} className="px-1 py-1 font-semibold text-slate-600">
                        {grupo}
                      </td>
                    </tr>
                    {ACCIONES_POR_ROL.filter((a) => a.grupo === grupo).map((a) => {
                      const pueden = rolesQuePueden(a.permiso);
                      return (
                        <tr key={`${grupo}-${a.accion}`} className="border-b border-slate-100 last:border-0">
                          <td className="py-1.5 pr-3 text-slate-700">{a.accion}</td>
                          {ROLES_DEL_SISTEMA.map((rol) => (
                            <td key={rol} className="px-2 py-1.5 text-center">
                              {pueden.includes(rol) ? (
                                <Check className="mx-auto h-3.5 w-3.5 text-emerald-600" aria-label="Sí" />
                              ) : (
                                <Minus className="mx-auto h-3 w-3 text-slate-300" aria-label="No" />
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
