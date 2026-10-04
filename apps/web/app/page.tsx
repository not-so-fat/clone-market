import { marketService } from "../src/runtime";
import { renderCatalog } from "../src/presentation";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const market = await marketService();
  const catalog = await market.catalog({
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.capability ? { capability: filters.capability } : {}),
    ...(filters.integration ? { integration: filters.integration } : {}),
    ...(filters.evidenceState ? { evidenceState: filters.evidenceState as "fresh" | "stale" | "missing" | "listed" | "discussed" | "emerging" | "observed_use" } : {}),
  });
  return <><section className="hero"><p className="eyebrow">Reusable agent templates</p><h1>Browse what’s public.<br />Review every private import.</h1><p>Adoption labels describe public evidence only. They never imply private usage.</p></section>
    <form className="filters"><label>Category<input name="category" defaultValue={filters.category} /></label><label>Capability<select name="capability" defaultValue={filters.capability ?? ""}><option value="">Any</option><option>instructions</option><option>memory</option><option>skill</option><option>routine</option></select></label><label>Integration<input name="integration" defaultValue={filters.integration} /></label><label>Evidence<select name="evidenceState" defaultValue={filters.evidenceState ?? ""}><option value="">Any</option><option value="listed">Listed</option><option value="discussed">Discussed</option><option value="emerging">Emerging</option><option value="observed_use">Observed use</option><option value="fresh">Fresh</option><option value="stale">Stale</option><option value="missing">Missing</option></select></label><button>Filter</button></form>
    <p className="result-count">{catalog.total} templates · complete catalog</p><div dangerouslySetInnerHTML={{ __html: renderCatalog(catalog.items) }} /></>;
}
