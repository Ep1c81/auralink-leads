import { skeletonBlock } from "@/components/outreach/theme";

export default function HoyLoading() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 sm:px-6 lg:py-12"
      aria-busy="true"
      aria-label="Cargando lista de hoy"
    >
      <div className={`${skeletonBlock} h-12 w-56`} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className={`${skeletonBlock} h-16`} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={`${skeletonBlock} h-48`} />
        ))}
      </div>
    </main>
  );
}
