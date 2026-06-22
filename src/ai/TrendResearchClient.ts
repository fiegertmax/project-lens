import Anthropic from '@anthropic-ai/sdk';
import { AI_RESEARCH } from '../config';
import type { ResearchPrompt } from './researchPrompt';

/** Streaming callbacks for one research run. */
export interface ResearchHandlers {
  onText: (delta: string) => void;
  onDone: (full: string) => void;
  onError: (message: string) => void;
}

/**
 * Thin wrapper around the Anthropic SDK for the trend-research feature.
 * Runs Haiku with the server-side web search tool and streams the answer back.
 * The API key is supplied per call (the user pastes their own), so no client is cached.
 */
export class TrendResearchClient {
  async research(apiKey: string, prompt: ResearchPrompt, handlers: ResearchHandlers): Promise<void> {
    // dangerouslyAllowBrowser: the user enters their own key in a browser-only course tool.
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

    try {
      const stream = client.messages.stream({
        model: AI_RESEARCH.model,
        max_tokens: AI_RESEARCH.maxTokens,
        system: prompt.system,
        tools: [AI_RESEARCH.webSearch as Anthropic.ToolUnion],
        messages: prompt.messages,
      });

      stream.on('text', (delta) => handlers.onText(delta));

      const final = await stream.finalMessage();
      const text = final.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim();
      handlers.onDone(text);
    } catch (err) {
      handlers.onError(err instanceof Error ? err.message : String(err));
    }
  }
}
