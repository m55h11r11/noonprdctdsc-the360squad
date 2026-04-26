import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { BYOK_PROVIDERS, PROVIDER_META, isByokProvider } from './providers-meta';
import type { ByokProvider } from './providers-meta';

// This app is bring-your-own-key only — there is no server-side fallback
// provider, which means the deploy owner NEVER pays for an end-user's
// generation. Every call is attributed to the key the user provides.
//
// Provider metadata (labels, default models, docs URLs, key hints) lives in
// providers-meta.ts so Client Components can import it without dragging in
// @ai-sdk/* packages. This file is the SDK factory layer on top of that.

export { BYOK_PROVIDERS, PROVIDER_META, isByokProvider };
export type { ByokProvider };

// OpenAI-compatible base URLs. Any provider here just swaps baseURL.
// This lets us support 4 extra providers with a single SDK dependency
// (they all speak the OpenAI Chat Completions wire protocol).
const OPENAI_COMPAT_BASE: Partial<Record<ByokProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  // openai: uses SDK default
};

export function resolveModel(byok: {
  provider: ByokProvider;
  key: string;
  model?: string;
}): { model: LanguageModel; label: string } {
  const meta = PROVIDER_META[byok.provider];
  const modelId = (byok.model && byok.model.trim()) || meta.defaultModel;

  switch (byok.provider) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey: byok.key });
      return { model: client(modelId), label: `byok:anthropic:${modelId}` };
    }
    case 'google': {
      const client = createGoogleGenerativeAI({ apiKey: byok.key });
      return { model: client(modelId), label: `byok:google:${modelId}` };
    }
    case 'openai':
    case 'groq':
    case 'mistral':
    case 'openrouter': {
      const baseURL = OPENAI_COMPAT_BASE[byok.provider];
      const client = createOpenAI({
        apiKey: byok.key,
        ...(baseURL ? { baseURL } : {}),
      });
      return {
        model: client(modelId),
        label: `byok:${byok.provider}:${modelId}`,
      };
    }
  }
}
