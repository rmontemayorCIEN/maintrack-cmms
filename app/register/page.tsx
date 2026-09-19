import { redirect } from "next/navigation";

/** La liga vieja de registro: la contratación vive en /contratar. */
export default function RegisterPage() {
  redirect("/contratar");
}
