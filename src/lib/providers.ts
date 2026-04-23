import { gateway } from '@ai-sdk/gateway';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

// Default provider: Vercel AI Gateway with Claude Haiku 4.5. Cheap, fast,
// multi-modal native, good at instruction-following and bilingual output.
export const DEFAULT_MODEL_ID = 'anthropic/claude-haiku-4-5';

// Supported BYOK providers. Kept narrow (6) to avoid bloat, but broad enough
// to cover every major AI shop a user might already have a key for.
// - anthropic + google use their native SDKs (native multi-modal).
// - everything else is routed through @ai-sdk/openai with a baseURL swap.
//   This lets us support 4 more providers with zero extra dependencies,
//   since they all speak the OpenAI Chat Completions wire protocol.
export const BYOK_PROVIDERS = [
  'anthropic',
  'google',
  'openai',
  'groq',
  'mistral',
  'openrouter',
] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

// Human label + default model shown in the UI. Users can override the model
// ID via the "Model ID" text field in the Settings modal — so a power user
// on OpenRouter can type `anthropic/claude-opus-4-6` and route through their
// own OpenRouter credits.
export const PROVIDER_META: Record<
  ByokProvider,
  { label: string; defaultModel: string; docsUrl: string }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-4-5',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  google: {
    label: 'Google (Gemini)',
    defaultModel: 'gemini-2.5-flash',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  openai: {
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  groq: {
    label: 'Groq (Llama / Mixtral)',
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
  },
  mistral: {
    label: 'Mistral',
    defaultModel: 'mistral-small-latest',
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  openrouter: {
    label: 'OpenRouter (any model)',
    defaultModel: 'anthropic/claude-haiku-4-5',
    docsUrl: 'https://openrouter.ai/keys',
  },
};

// OpenAI-compatible base URLs. Any provider here just swaps baseURL.
const OPENAI_COMPAT_BASE: Partial<Record<ByokProvider, string>> = {
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  // openai: uses SDK default
};

export function isByokProvider(x: unknown): x is ByokProvider {
  return typeof x === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(x);
}

export function resolveModel(byok: {
  provider?: ByokProvider;
  key?: string;
  model?: string; // optional user override; falls back to PROVIDER_META default
}): { model: LanguageModel; label: string } {
  if (byok.provider && byok.key) {
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
        const client = createOpenAI({ apiKey: byok.key, ...(baseURL ? { baseURL } : {}) });
        return { model: client(modelId), label: `byok:${byok.provider}:${modelId}` };
      }
    }
  }
  return { model: gateway(DEFAULT_MODEL_ID), label: `gateway:${DEFAULT_MODEL_ID}` };
}
