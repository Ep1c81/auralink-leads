// Forces the dark, glassmorphism "high-tech" surface for the outreach module
// regardless of the visitor's system color scheme — deliberately distinct
// from the light, dark:-variant main dashboard at "/". Purely decorative and
// non-interactive, so this stays a Server Component.
export default function OutreachLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100"
      style={{ colorScheme: "dark" }}
    >
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full bg-violet-600/20 blur-[120px]" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-cyan-500/10 blur-[120px]" />
        <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-fuchsia-500/10 blur-[120px]" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}
