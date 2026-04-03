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
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_PLACES_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) {
    // Stub - return placeholder when no API key
    return `🔍 Web search not configured. (Query: "${query}")\n\nTo enable web search, add GOOGLE_API_KEY and GOOGLE_CSE_ID to your environment.`;
  }

  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=5`;
    const res = await fetch(url);
    if (!res.ok) return `Search error: ${res.status}`;
    const data = await res.json();
    const results = (data.items || []).slice(0, 5);
    if (results.length === 0) return 'No results found.';
    return results
      .map((r: { title: string; link: string; snippet: string }, i: number) =>
        `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`
      )
      .join('\n\n');
  } catch (e) {
    return `Search failed: ${e}`;
  }
}
