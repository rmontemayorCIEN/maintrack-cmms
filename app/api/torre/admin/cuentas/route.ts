import { conTorre, listaParaTorre, responder } from "@/lib/torre/cuentas";

/** Administracion desde la Torre de Control: las empresas cliente (lib/torre/cuentas.ts). */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return conTorre(request, async (carga) => responder(await listaParaTorre(carga)));
}
