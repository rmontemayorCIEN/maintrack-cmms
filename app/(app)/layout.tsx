import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Sidebar } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { BandaCliente } from "@/components/shell/banda-cliente";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <Sidebar
        tieneLogo={Boolean(user.organization.logoUrl)}
        orgName={user.organization.name}
        plan={user.organization.plan}
        esSuperAdmin={user.isSuperAdmin}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {user.actuandoComoCliente ? (
          <BandaCliente nombreCliente={user.organization.name} />
        ) : null}
        <Topbar
          user={{ name: user.name, email: user.email, role: user.role, color: user.color }}
        />
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
