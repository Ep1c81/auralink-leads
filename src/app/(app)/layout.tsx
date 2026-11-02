import Link from "next/link";
import { requireOperatorPage } from "@/lib/auth";
import { signOut } from "@/app/login/actions";

const NAV_LINKS = [
  { href: "/dashboard", label: "Oportunidades" },
  { href: "/outreach", label: "Mensajes y envíos" },
  { href: "/", label: "Pipeline BANT" },
] as const;

/**
 * Layout de todas las páginas privadas. Verifica identidad + allowlist en el
 * servidor antes de renderizar (además del proxy). Cada API y lectura de
 * datos vuelve a verificar por su cuenta.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const operator = await requireOperatorPage();
  return (
    <>
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-gray-900"
      >
        Saltar al contenido
      </a>
      <nav
        aria-label="Principal"
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-white/10 bg-slate-950 px-4 py-3 text-sm text-white/80 sm:px-6"
      >
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded px-1.5 py-1 font-medium transition-colors hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            {link.label}
          </Link>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-white/60 sm:inline" title="Sesión iniciada">
            {operator.email}
          </span>
          <form action={signOut}>
            <button
              type="submit"
              className="rounded border border-white/20 px-2 py-1 font-medium hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </nav>
      <div id="contenido" className="flex flex-1 flex-col">
        {children}
      </div>
    </>
  );
}
