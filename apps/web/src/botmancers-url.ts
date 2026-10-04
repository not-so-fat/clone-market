/** Build the Botmancers UI URL for an imported bot (`bots/<id>`). */
export function botmancersBotUrl(uiBaseUrl: string, botId: string): string {
  const base = uiBaseUrl.endsWith("/") ? uiBaseUrl : `${uiBaseUrl}/`;
  return new URL(`bots/${encodeURIComponent(botId)}`, base).toString();
}
