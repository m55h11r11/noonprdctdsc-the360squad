import { gateway } from '@ai-sdk/gateway';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { LanguageModel } from 'ai';

// Default provider: Vercel AI Gateway with Claude Haiku 4.5.
// Cheap (~$0.80 / MTok in, $4 / MTok out), fast, good at instruction-following
// and bilingual output. Haiku picks multi-modal inputs natively.
export const DEFAULT_MODEL_ID = 'anthropic/claude-haiku-4-5';

// BYOK provider IDs the client can pass in the x-byok-provider header.
export type ByokProvider = 'anthropic' | 'google';

// Map from the client-chosen provider to the concrete model string we pass
// to the SDK. Kept narrow deliberately — two providers, two models.
const BYOK_MODELS: Record<ByokProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  google: 'gemini-2.5-flash',
};

export function resolveModel(byok: {
  provider?: ByokProvider;
  key?: string;
}): { model: LanguageModel; label: string } {
  if (byok.provider && byok.key) {
    switch (byok.provider) {
      case 'anthropic': {
        const client = createAnthropic({ apiKey: byok.key });
        return {
          model: client(BYOK_MODELS.anthropic),
          label: `byok:${BYOK_MODELS.anthropic}`,
        };
      }
      case 'google': {
        const client = createGoogleGenerativeAI({ apiKey: byok.key });
        return {
          model: client(BYOK_MODELS.google),
          label: `byok:${BYOK_MODELS.google}`,
        };
      }
    }
  }
  return { model: gateway(DEFAULT_MODEL_ID), label: `gateway:${DEFAULT_MODEL_ID}` };
}
