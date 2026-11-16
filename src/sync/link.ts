/** Builds the QR/join link from the current page so the deployed sub-path (e.g. /kelime-atlasi/) is kept. The code stays in the fragment. */
export function joinLinkFor(pageHref: string, baseUrl: string, code: string): string {
  const page = pageHref.split("#")[0];
  const base = new URL(baseUrl, page);
  base.search = "";
  base.hash = "";
  return `${base.href}#/sync?c=${code}`;
}
