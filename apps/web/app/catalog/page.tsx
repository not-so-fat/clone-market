import { marketService } from "../../src/runtime";
import { renderCatalog } from "../../src/presentation";
import { MarketError } from "../../src/market";

export const dynamic = "force-dynamic";

export default async function CatalogPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const filters = await searchParams;
  const market = await marketService();
  let catalog;
  try {
    catalog = await market.catalog({
      ...(filters.category ? { category: filters.category } : {}),
      ...(filters.capability ? { capability: filters.capability } : {}),
      ...(filters.integration ? { integration: filters.integration } : {}),
      ...(filters.evidenceState ? { evidenceState: filters.evidenceState as "fresh" | "stale" | "missing" | "listed" | "discussed" | "emerging" | "observed_use" } : {}),
    });
  } catch (error) {
    const code = error instanceof MarketError ? error.code : "catalog_unavailable";
    const message = error instanceof Error ? error.message : "The catalog is temporarily unavailable";
    return <><a className="back" href="/">← Trial home</a><section className="hero"><p className="eyebrow">Recoverable catalog error</p><h1>Catalog temporarily unavailable</h1><div className="alert danger"><strong>{code}</strong>: {message}</div><p>No clone was created or activated. Reload to retry the catalog database.</p><a href="/catalog">Retry catalog</a></section></>;
  }
  return <><a className="back" href="/">← Trial home</a><section className="hero"><p className="eyebrow">Reusable agent templates</p><h1>Browse what’s public.<br />Review every private import.</h1><p>Adoption labels describe public evidence only. They never imply private usage.</p></section>
    <form className="filters"><label>Category<input name="category" defaultValue={filters.category} /></label><label>Capability<select name="capability" defaultValue={filters.capability ?? ""}><option value="">Any</option><option>instructions</option><option>memory</option><option>skill</option><option>routine</option></select></label><label>Integration<input name="integration" defaultValue={filters.integration} /></label><label>Evidence<select name="evidenceState" defaultValue={filters.evidenceState ?? ""}><option value="">Any</option><option value="listed">Listed</option><option value="discussed">Discussed</option><option value="emerging">Emerging</option><option value="observed_use">Observed use</option><option value="fresh">Fresh</option><option value="stale">Stale</option><option value="missing">Missing</option></select></label><button>Filter</button></form>
    {catalog.filterWarnings.length > 0 && <div className="alert warning" role="status"><strong>Some live details could not be checked.</strong> {catalog.filterWarnings.length} template{catalog.filterWarnings.length === 1 ? " was" : "s were"} omitted from these capability filters because its public source drifted or was unavailable. Clear the capability filters to keep browsing the complete stored catalog.</div>}
    <p className="result-count">{catalog.total} templates · complete traversal{catalog.filterWarnings.length > 0 ? " with noted live-detail omissions" : ""}</p><div dangerouslySetInnerHTML={{ __html: renderCatalog(catalog.items) }} /></>;
}
