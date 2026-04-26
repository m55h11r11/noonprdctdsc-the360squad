// Client-safe provider metadata. NO @ai-sdk/* imports here — this module
// must remain importable from Client Components. Server-only factory
// logic lives in src/lib/providers.ts and layers on top of these exports.

export const BYOK_PROVIDERS = [
  'anthropic',
  'google',
  'openai',
  'groq',
  'mistral',
  'openrouter',
] as const;

export type ByokProvider = (typeof BYOK_PROVIDERS)[number];

// Human label, default model shown in the UI, docs URL for getting a key,
// and the placeholder hint shown in the key input field. Users can override
// the model ID via the "Model ID" text field in the Settings modal — so a
// power user on OpenRouter can type `anthropic/claude-opus-4-6` and route
// through their own OpenRouter credits.
export const PROVIDER_META: Record<
  ByokProvider,
  { label: string; defaultModel: string; docsUrl: string; keyHint: string }
> = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-4-5',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-...',
  },
  google: {
    label: 'Google (Gemini)',
    defaultModel: 'gemini-2.5-flash',
    docsUrl: 'https://aistudio.google.com/app/apikey',
    keyHint: 'AIza...',
  },
  openai: {
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    docsUrl: 'https://platform.openai.com/api-keys',
    keyHint: 'sk-...',
  },
  groq: {
    label: 'Groq (Llama / Mixtral)',
    defaultModel: 'llama-3.3-70b-versatile',
    docsUrl: 'https://console.groq.com/keys',
    keyHint: 'gsk_...',
  },
  mistral: {
    label: 'Mistral',
    defaultModel: 'mistral-small-latest',
    docsUrl: 'https://console.mistral.ai/api-keys',
    keyHint: '...',
  },
  openrouter: {
    label: 'OpenRouter (any model)',
    defaultModel: 'anthropic/claude-haiku-4-5',
    docsUrl: 'https://openrouter.ai/keys',
    keyHint: 'sk-or-...',
  },
};

export function isByokProvider(x: unknown): x is ByokProvider {
  return typeof x === 'string' && (BYOK_PROVIDERS as readonly string[]).includes(x);
}
