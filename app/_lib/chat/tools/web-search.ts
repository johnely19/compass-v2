/**
 * Web search tool implementation.
 * Provides real-time search capabilities for the Compass Concierge.
 */

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

/**
 * Search the web for current information.
 * @param query - Search query string
 * @returns Formatted search results or error message
 */
export async function braveSearch(query: string): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    // Stub - return placeholder when no API key
    return `🔍 Web search not configured. (Query: "${query}")\n\nTo enable web search, add BRAVE_SEARCH_API_KEY to your environment.`;
  }

  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`;
    const res = await fetch(url, {
      headers: { 'X-Subscription-Token': apiKey, Accept: 'application/json' },
    });
    if (!res.ok) return `Search error: ${res.status}`;
    const data = await res.json();
    const results = (data.web?.results || []).slice(0, 5);
    if (results.length === 0) return 'No results found.';
    return results
      .map((r: WebSearchResult, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description}`
      )
      .join('\n\n');
  } catch (e) {
    return `Search failed: ${e}`;
  }
}
