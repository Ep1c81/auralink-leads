/** Costa Rica's seven provinces, spelled as they should appear in outreach payloads. */
export const CR_PROVINCES = [
  "San José",
  "Alajuela",
  "Cartago",
  "Heredia",
  "Guanacaste",
  "Puntarenas",
  "Limón",
] as const;

export type CrProvince = (typeof CR_PROVINCES)[number];

// All 84 cantons, plus a few common alternate names.
const CANTONS_BY_PROVINCE: Record<CrProvince, string[]> = {
  "San José": [
    "San José", "Escazú", "Desamparados", "Puriscal", "Tarrazú", "Aserrí", "Mora",
    "Goicoechea", "Santa Ana", "Alajuelita", "Vázquez de Coronado", "Coronado", "Acosta",
    "Tibás", "Moravia", "Montes de Oca", "Turrubares", "Dota", "Curridabat",
    "Pérez Zeledón", "León Cortés", "León Cortés Castro",
  ],
  Alajuela: [
    "Alajuela", "San Ramón", "Grecia", "San Mateo", "Atenas", "Naranjo", "Palmares", "Poás",
    "Orotina", "San Carlos", "Zarcero", "Sarchí", "Valverde Vega", "Upala", "Los Chiles",
    "Guatuso", "Río Cuarto",
  ],
  Cartago: [
    "Cartago", "Paraíso", "La Unión", "Jiménez", "Turrialba", "Alvarado", "Oreamuno", "El Guarco",
  ],
  Heredia: [
    "Heredia", "Barva", "Santo Domingo", "Santa Bárbara", "San Rafael", "San Isidro", "Belén",
    "Flores", "San Pablo", "Sarapiquí",
  ],
  Guanacaste: [
    "Liberia", "Nicoya", "Santa Cruz", "Bagaces", "Carrillo", "Cañas", "Abangares", "Tilarán",
    "Nandayure", "La Cruz", "Hojancha",
  ],
  Puntarenas: [
    "Puntarenas", "Esparza", "Buenos Aires", "Montes de Oro", "Osa", "Quepos", "Aguirre",
    "Golfito", "Coto Brus", "Parrita", "Corredores", "Garabito", "Monteverde", "Puerto Jiménez",
  ],
  Limón: ["Limón", "Pococí", "Siquirres", "Talamanca", "Matina", "Guácimo"],
};

/** Lowercase, strip accents and collapse whitespace so "Escazu" matches "Escazú". */
function normalize(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const PROVINCE_BY_PLACE = new Map<string, CrProvince>();
for (const province of CR_PROVINCES) {
  for (const canton of CANTONS_BY_PROVINCE[province]) PROVINCE_BY_PLACE.set(normalize(canton), province);
}
// A province name always wins over a canton that happens to share it.
for (const province of CR_PROVINCES) PROVINCE_BY_PLACE.set(normalize(province), province);

/**
 * Province for a bizmap_leads address, or "" when it can't be told — e.g.
 * "GAM, Costa Rica", which spans four provinces. Each comma-separated part is
 * matched whole against province and canton names, last part first, so a
 * street name containing a canton name doesn't produce a false match.
 */
export function provinceFromAddress(address: string | null | undefined): CrProvince | "" {
  const parts = (address ?? "").split(",").map(normalize).filter(Boolean);
  for (const part of parts.reverse()) {
    const province = PROVINCE_BY_PLACE.get(part);
    if (province) return province;
  }
  return "";
}

export function isCrProvince(value: unknown): value is CrProvince {
  return typeof value === "string" && (CR_PROVINCES as readonly string[]).includes(value);
}
