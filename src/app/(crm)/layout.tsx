import { requireOperator } from "@/lib/security/auth";
export default async function CRMLayout({ children }: { children: React.ReactNode }) { await requireOperator(); return <>{children}<form action="/api/auth/logout" method="post"><button className="m-4 underline">Cerrar sesión</button></form></>; }
