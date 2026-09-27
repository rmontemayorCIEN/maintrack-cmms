import { LifeBuoy, Presentation,
  Activity, AlertTriangle, BarChart3, Bell, BookOpen, Boxes, Building2, CalendarDays, ClipboardCheck, ClipboardList,
  Cpu, Factory, Flame, Gauge, Home, Inbox, KanbanSquare, Library, LineChart, ListChecks, MessageCircleQuestion,
  PackageX, PauseCircle, Plus, QrCode, Rocket, ScanLine, Search, Settings, ShoppingCart, Sparkles, Truck, Upload,
  UsersRound, Waypoints, Wrench, Footprints, ShieldCheck, Table2, FileSignature, Fuel, Droplets, HardHat, Zap, ScrollText,
} from "lucide-react";

/**
 * Los íconos del menú, por nombre. lib/pantallas.ts no depende de React: dice
 * el nombre y aquí se pinta.
 */
const ICONOS: Record<string, React.ComponentType<{ className?: string }>> = {
  inicio: Home, tablero: KanbanSquare, calendario: CalendarDays, solicitudes: Inbox, qr: QrCode,
  alertas: AlertTriangle, ordenes: ClipboardList, armar: Wrench, backlog: PackageX, personal: UsersRound,
  activos: Factory, escanear: ScanLine, medidores: Cpu, planes: ListChecks, conjuntos: Waypoints,
  predictivo: Activity, almacen: Boxes, requisiciones: ClipboardList, compras: ShoppingCart, proveedores: Truck,
  indicadores: LineChart, paros: Flame, reportes: BarChart3, consulta: MessageCircleQuestion, diagnostico: Sparkles,
  puesta: Rocket, catalogos: Library, importar: Upload, glosario: BookOpen, soporte: LifeBuoy, demo: Presentation, ajustes: Settings, clientes: Building2,
  vigencias: ShieldCheck, registros: Table2, normas: ScrollText,
  // Iconos de las plantillas de registros propios (lib/registros-plantillas.ts).
  contrato: FileSignature, combustible: Fuel, agua: Droplets, proteccion: HardHat,
  herramienta: Wrench, contratista: HardHat, energia: Zap,
  rondin: Footprints, avisos: Bell, nueva: Plus, buscar: Search, revisar: ClipboardCheck, bloqueo: PauseCircle, panel: Gauge,
};

export function IconoMenu({ nombre, className = "h-4 w-4" }: { nombre: string; className?: string }) {
  const Icono = ICONOS[nombre] ?? Gauge;
  return <Icono className={className} />;
}
