import { redirect } from "next/navigation";
import { marketService } from "../src/runtime";
import { MarketError } from "../src/market";
import { renderGrokUrlError, renderSearchError, renderSearchResults, renderTrialHome } from "../src/presentation";

export const dynamic = "force-dynamic";

export default async function TrialHomePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const market = await marketService();
  const sections = [renderTrialHome()];
  const submittedUrl = typeof params.url === "string" ? params.url : "";
  if (submittedUrl.length > 0) {
    let destination: string | undefined;
    try {
      const resolved = await market.resolveGrokBotUrl(submittedUrl);
      destination = `/templates/${encodeURIComponent(resolved.source.provider)}/${encodeURIComponent(resolved.source.externalId)}/agent-deck-preview`;
    } catch (error) {
      const code = error instanceof MarketError ? error.code : "preview_unavailable";
      const message = error instanceof Error ? error.message : "That URL could not be resolved";
      sections.push(renderGrokUrlError({ code, message }));
    }
    if (destination) redirect(destination);
  }
  const submittedQuery = typeof params.q === "string" ? params.q : "";
  if (submittedQuery.trim().length > 0) {
    try {
      const result = await market.searchCatalog(submittedQuery);
      sections.push(renderSearchResults(result.query, result.items, result.total));
    } catch (error) {
      const code = error instanceof MarketError ? error.code : "search_unavailable";
      const message = error instanceof Error ? error.message : "Search is temporarily unavailable";
      sections.push(renderSearchError({ code, message }));
    }
  }
  return <div dangerouslySetInnerHTML={{ __html: sections.join("") }} />;
}
