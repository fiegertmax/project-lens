import Anthropic from '@anthropic-ai/sdk';
import { AI_RESEARCH } from '../config';
import type { TrendContext } from './trendContext';

/** A ready-to-send system prompt plus the few-shot message stack. */
export interface ResearchPrompt {
  system: string;
  messages: Anthropic.MessageParam[];
}

/** Formats one factor line, e.g. "- Coal: +38%". */
function factorLine(label: string, pctChange: number): string {
  const sign = pctChange > 0 ? '+' : '';
  return `- ${label}: ${sign}${pctChange.toFixed(0)}%`;
}

/** Builds the dynamic user turn from exactly the factors on display. */
function userMessage(ctx: TrendContext): string {
  return [
    `Country: ${ctx.country}`,
    `Period: ${ctx.startYear}–${ctx.endYear}`,
    `Land use change: ${ctx.includeLUC ? 'included' : 'excluded'}`,
    'Factors that changed materially on the chart:',
    ...ctx.factors.map((f) => factorLine(f.label, f.pctChange)),
    `Only explain causes that occurred within ${ctx.startYear}–${ctx.endYear}. Causes outside this period must not appear.`,
    'Research the real-world causes behind these changes.',
  ].join('\n');
}

/**
 * Assembles the few-shot prompt: fixed system rules, one worked example, then the
 * country-specific request. The factor list is fully dynamic — only the sources present
 * on the selected chart are sent, so the model researches nothing that isn't displayed.
 */
export function buildResearchPrompt(ctx: TrendContext): ResearchPrompt {
  return {
    system: AI_RESEARCH.system,
    messages: [
      { role: 'user', content: AI_RESEARCH.exampleUser },
      { role: 'assistant', content: AI_RESEARCH.exampleAssistant },
      { role: 'user', content: userMessage(ctx) },
    ],
  };
}
