import { ok } from "@/lib/api";
import { olvidarReportante } from "@/lib/portal";

/** Deja de recordar el celular en este dispositivo. Publico a proposito. */
export async function POST() {
  await olvidarReportante();
  return ok({ success: true });
}
