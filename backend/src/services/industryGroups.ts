/**
 * Canonical industry grouping.
 *
 * Lead `industry` labels are highly fragmented — they come from Google Maps
 * categories (via Serper) plus whatever niche the user typed, so the same broad
 * trade shows up as many specific/sub-industry labels ("Immigration attorney",
 * "Law firm", "Personal injury attorney" …) and occasionally a non-English
 * variant ("Abogado", "Plombier"). This rolls those into broad parent buckets
 * so the audit benchmark averages related businesses together instead of
 * splitting into tiny fragments.
 *
 * Matching is plain lowercase substring matching, evaluated in array order, so
 * MORE SPECIFIC buckets must come first (e.g. Web Design before Interior &
 * Design; Jewelry before Design so "jewelry designer" → Jewelry; Legal before
 * Real Estate so "real estate attorney" → Legal; Dental/Chiropractor before
 * Healthcare so "dental clinic" → Dental).
 *
 * Coverage is English (which is what Google's categories return, even for
 * non-English countries) plus the most common core-EU synonyms for the main
 * trades. Anything that matches no bucket returns null, and the caller falls
 * back to the exact label / all-industries average — so unmapped labels never
 * break, they just aren't pooled until a keyword is added here.
 */

export interface IndustryGroup {
  key: string;
  label: string;
  keywords: string[];
}

// Order = priority. Specific buckets first.
const GROUPS: IndustryGroup[] = [
  { key: "web_design", label: "Web Design", keywords: ["website design", "web design", "website develop", "web develop", "webdesign"] },
  { key: "jewelry", label: "Jewelry", keywords: ["jewel", "diamond", "joyer", "joaill", "gioiell"] },
  { key: "legal", label: "Legal", keywords: ["lawyer", "attorney", "law firm", "legal", "abogad", "advogad", "avvocat", "avocat", "rechtsanwalt", "anwalt", "solicitor", "barrister"] },
  { key: "real_estate", label: "Real Estate", keywords: ["real estate", "realtor", "realty", "inmobiliar", "immobili", "immobilier"] },
  { key: "dental", label: "Dental", keywords: ["dentist", "dental", "dentista", "dentaire", "zahnarzt", "odontolog"] },
  { key: "chiropractor", label: "Chiropractor", keywords: ["chiropract", "quiropract", "chiropracteur"] },
  { key: "plumbing", label: "Plumbing", keywords: ["plumb", "fontaner", "plombier", "idraulic", "klempner", "loodgieter", "encanador"] },
  { key: "electrical", label: "Electrical", keywords: ["electric", "electricista", "électricien", "electricien", "elettricist", "elektriker"] },
  { key: "tattoo", label: "Tattoo & Piercing", keywords: ["tattoo", "piercing", "tatuaj", "tatouage", "tätowier", "tatuador"] },
  { key: "beauty", label: "Beauty & Salon", keywords: ["salon", "saloon", "barber", "hairdress", "peluquer", "coiffe", "friseur", "estétic", "esthetic", "beauty"] },
  { key: "fitness", label: "Fitness & Wellness", keywords: ["fitness", "yoga", "pilates", "gym", "wellness", "spa", "gimnasio"] },
  { key: "marketing", label: "Marketing & Advertising", keywords: ["marketing", "advertis", "media", "publicidad", "publicité"] },
  { key: "construction", label: "Construction & Roofing", keywords: ["construction", "construcción", "roofing", "roofer", "remodel", "renovation", "contractor", "builder", "bâtiment", "dachdecker"] },
  { key: "interior_design", label: "Interior & Design", keywords: ["interior", "design", "decor", "diseño", "décorat", "creative"] },
  { key: "technology", label: "Technology", keywords: ["technolog", "tecnolog", "cyber", "software", "analytics", "startup", "saas", "fintech"] },
  { key: "automotive", label: "Automotive", keywords: ["automotive", "auto repair", "car ", "motor", "garage", "mobility"] },
  { key: "finance", label: "Finance & Insurance", keywords: ["finance", "financ", "bank", "insurance", "credit union", "accounting", "seguros", "assurance"] },
  { key: "healthcare", label: "Healthcare", keywords: ["healthcare", "medical", "clinic", "clínica", "dermatolog", "hospital"] },
  { key: "food", label: "Food & Restaurant", keywords: ["food", "restaurant", "restaurante", "cafe", "café", "catering", "bakery", "panader"] },
  { key: "education", label: "Education", keywords: ["education", "school", "academy", "training", "escuela"] },
  { key: "logistics", label: "Logistics", keywords: ["logistic", "freight", "shipping", "courier", "transport"] },
  { key: "energy", label: "Energy", keywords: ["energy", "energ", "solar", "renewable"] },
  { key: "art", label: "Art & Entertainment", keywords: ["art gallery", "art center", "gallery", "entertainment", "fashion", "museum"] },
];

/**
 * Map a raw industry label to its canonical parent bucket.
 * Returns null when no bucket matches (caller should fall back).
 */
export function canonicalIndustry(raw: string | null | undefined): { key: string; label: string } | null {
  const s = (raw || "").trim().toLowerCase();
  if (!s) return null;
  for (const g of GROUPS) {
    if (g.keywords.some((k) => s.includes(k))) {
      return { key: g.key, label: g.label };
    }
  }
  return null;
}
