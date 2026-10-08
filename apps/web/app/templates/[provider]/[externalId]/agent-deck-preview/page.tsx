import { marketService } from "../../../../../src/runtime";
import { renderAgentDeckPreview, renderAgentDeckPreviewError } from "../../../../../src/presentation";
import { MarketError } from "../../../../../src/market";

export const dynamic = "force-dynamic";

export default async function AgentDeckPreviewPage({ params }: { params: Promise<{ provider: string; externalId: string }> }) {
  const identity = await params;
  const market = await marketService();
  try {
    const preview = await market.agentDeckPreview(identity);
    return <div dangerouslySetInnerHTML={{ __html: renderAgentDeckPreview(preview) }} />;
  } catch (error) {
    const code = error instanceof MarketError ? error.code : "preview_unavailable";
    const message = error instanceof Error ? error.message : "The registration preview is temporarily unavailable";
    return <div dangerouslySetInnerHTML={{ __html: renderAgentDeckPreviewError({ code, message }, identity) }} />;
  }
}
