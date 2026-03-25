import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';

const client = new Anthropic();

export interface ParsedAccommodation {
  name: string;
  address?: string;
  checkIn?: string;
  checkOut?: string;
  confirmationNumber?: string;
  host?: string;
  notes?: string;
  raw: string;
}

export async function POST(request: NextRequest) {
  try {
    const { text, contextKey } = await request.json() as { text: string; contextKey?: string };

    if (!text?.trim()) {
      return NextResponse.json({ error: 'text required' }, { status: 400 });
    }

    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Extract accommodation booking details from this text. Return ONLY a JSON object with these fields (omit fields that aren't mentioned):
- name: string (hotel/host name, e.g. "Arnold's", "Ace Hotel")
- address: string (full address if provided)
- checkIn: string (date in YYYY-MM-DD if mentioned)
- checkOut: string (date in YYYY-MM-DD if mentioned)
- confirmationNumber: string
- host: string (host name if Airbnb/private rental)
- notes: string (any other relevant details)

Text: "${text.replace(/"/g, '\\"')}"

Return only the JSON object, no explanation.`,
      }],
    });

    const content = msg.content[0];
    if (!content || content.type !== 'text') throw new Error('unexpected response');

    // Parse the JSON response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('no JSON in response');

    const parsed = JSON.parse(jsonMatch[0]) as Omit<ParsedAccommodation, 'raw'>;

    return NextResponse.json({ ...parsed, raw: text });
  } catch (err) {
    console.error('[parse-accommodation]', err);
    return NextResponse.json({ error: 'Failed to parse accommodation' }, { status: 500 });
  }
}
