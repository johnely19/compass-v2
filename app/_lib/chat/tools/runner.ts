/**
 * Tool runner - dispatches tool calls by name to the appropriate implementation.
 */

import { braveSearch } from './web-search';
import { lookupPlace } from './lookup-place';
import { addToCompass, type AddToCompassInput } from './add-to-compass';
import { saveDiscovery, type SaveDiscoveryInput } from './save-discovery';
import { updateTrip, type UpdateTripInput } from './update-trip';
import { createContext, type CreateContextInput } from './create-context';

export type ToolName =
  | 'web_search'
  | 'lookup_place'
  | 'add_to_compass'
  | 'save_discovery'
  | 'update_trip'
  | 'create_context';

export type ToolInput =
  | { query: string }
  | AddToCompassInput
  | SaveDiscoveryInput
  | UpdateTripInput
  | CreateContextInput;

/**
 * Execute a tool call by name.
 * @param name - Tool name
 * @param input - Tool input parameters
 * @param userId - User identifier (for tools that require it)
 * @returns Tool result as string
 */
export async function runToolCall(
  name: ToolName,
  input: Record<string, unknown>,
  userId: string,
): Promise<string> {
  switch (name) {
    case 'web_search':
      return braveSearch(input.query as string);
    case 'lookup_place':
      return lookupPlace(input.query as string);
    case 'add_to_compass':
      return addToCompass(userId, input as unknown as AddToCompassInput);
    case 'save_discovery':
      return saveDiscovery(userId, input as unknown as SaveDiscoveryInput);
    case 'update_trip':
      return updateTrip(userId, input as unknown as UpdateTripInput);
    case 'create_context':
      return createContext(userId, input as unknown as CreateContextInput);
    default:
      return `Unknown tool: ${name as string}`;
  }
}
