'use client';

import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Check,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Plus,
  Settings,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { fileToResizedDataUrl } from '@/lib/image';
import { downloadCsv, productsToCsv, type ProductRow } from '@/lib/csv';
import type { Listing } from '@/lib/schema';

// ─── Types ──────────────────────────────────────────────────────────────────

type ByokProvider =
  | 'anthropic'
  | 'google'
  | 'openai'
  | 'groq'
  | 'mistral'
  | 'openrouter';

interface ByokState {
  provider: ByokProvider;
  key: string;
  model?: string; // optional — overrides the per-provider default
}

interface ProductState {
  id: string;
  name: string;
  text: string; // textarea content — URLs pasted in free-form
  note: string;
  images: string[]; // resized JPEG data URLs
  result: Listing | null;
  loading: boolean;
  error: string | null;
}

// Keep this list in sync with src/lib/providers.ts PROVIDER_META.
// Duplicated here so the client doesn't need to import server-only deps.
const PROVIDER_OPTIONS: Array<{
  id: ByokProvider;
  label: string;
  defaultModel: string;
  keysUrl: string;
  hint: string;
}> = [
  {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-haiku-4-5',
    keysUrl: 'https://console.anthropic.com/settings/keys',
    hint: 'sk-ant-...',
  },
  {
    id: 'google',
    label: 'Google (Gemini)',
    defaultModel: 'gemini-2.5-flash',
    keysUrl: 'https://aistudio.google.com/app/apikey',
    hint: 'AIza...',
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    keysUrl: 'https://platform.openai.com/api-keys',
    hint: 'sk-...',
  },
  {
    id: 'groq',
    label: 'Groq (Llama / Mixtral)',
    defaultModel: 'llama-3.3-70b-versatile',
    keysUrl: 'https://console.groq.com/keys',
    hint: 'gsk_...',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    defaultModel: 'mistral-small-latest',
    keysUrl: 'https://console.mistral.ai/api-keys',
    hint: '...',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter (any model)',
    defaultModel: 'anthropic/claude-haiku-4-5',
    keysUrl: 'https://openrouter.ai/keys',
    hint: 'sk-or-...',
  },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const BYOK_STORAGE_KEY = 'noon-desc.byok.v2'; // v2: added optional `model`

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function parseUrls(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => {
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    });
}

function newProduct(idx: number): ProductState {
  return {
    id: uid(),
    name: `منتج ${idx}`,
    text: '',
    note: '',
    images: [],
    result: null,
    loading: false,
    error: null,
  };
}

// ─── Inline components ──────────────────────────────────────────────────────

function CopyButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(getText());
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — silent */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      aria-label="نسخ"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'تم النسخ' : 'نسخ'}
    </button>
  );
}

function CodeBlock({
  label,
  text,
  direction,
}: {
  label: string;
  text: string;
  direction: 'rtl' | 'ltr';
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>{label}</span>
        <CopyButton getText={() => text} />
      </div>
      <pre
        className={`whitespace-pre-wrap break-words p-3 text-sm leading-6 text-zinc-800 dark:text-zinc-200 ${direction}`}
      >
        {text}
      </pre>
    </div>
  );
}

function renderListingEn(l: Listing): string {
  return [
    `TITLE:\n${l.en.title}`,
    `\nDESCRIPTION:\n${l.en.description}`,
    `\nFEATURES:\n${l.en.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
  ].join('\n');
}

function renderListingAr(l: Listing): string {
  return [
    `العنوان:\n${l.ar.title}`,
    `\nالوصف:\n${l.ar.description}`,
    `\nالميزات:\n${l.ar.features.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
  ].join('\n');
}

// ─── Flexible BYOK modal ────────────────────────────────────────────────────

function ByokModal({
  initial,
  onSave,
  onClose,
}: {
  initial: ByokState | null;
  onSave: (value: ByokState | null) => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<ByokProvider>(initial?.provider ?? 'anthropic');
  const [key, setKey] = useState(initial?.key ?? '');
  const [model, setModel] = useState(initial?.model ?? '');
  const [show, setShow] = useState(false);

  const meta = PROVIDER_OPTIONS.find((p) => p.id === provider)!;
  const effectiveModel = (model.trim() || meta.defaultModel);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">استخدم مفتاح API خاص بك</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          الصق مفتاح API من أي مزود لتحصل على إنشاءات غير محدودة بحسابك. يُحفظ المفتاح في متصفحك فقط، ويُمرَّر إلى المزود مباشرة لهذه العملية، دون تخزين على خادمنا.
        </p>

        <label className="mb-3 block text-sm font-medium">
          المزود
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as ByokProvider);
              setModel(''); // reset custom model when provider changes
            }}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mb-3 block text-sm font-medium">
          معرّف النموذج <span className="text-xs font-normal text-zinc-500">(اختياري)</span>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder={meta.defaultModel}
            className="ltr mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            اتركه فارغًا لاستخدام: <code className="ltr inline">{meta.defaultModel}</code>
          </span>
        </label>

        <label className="mb-2 block text-sm font-medium">
          مفتاح API
          <div className="relative mt-1">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={meta.hint}
              className="ltr block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-16 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {show ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
        </label>
        <p className="mb-5 text-xs text-zinc-500">
          احصل على مفتاح من{' '}
          <a href={meta.keysUrl} target="_blank" rel="noreferrer" className="underline">
            {new URL(meta.keysUrl).hostname}
          </a>
          {provider === 'google' || provider === 'groq' ? ' — يتوفر وصول مجاني.' : '.'}
        </p>

        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              onSave(null);
              onClose();
            }}
            className="rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            مسح المفتاح
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              إلغاء
            </button>
            <button
              type="button"
              disabled={!key.trim()}
              onClick={() => {
                onSave({
                  provider,
                  key: key.trim(),
                  ...(model.trim() ? { model: effectiveModel } : {}),
                });
                onClose();
              }}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              حفظ
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Unified input: textarea + images in one box + paste support ────────────

function UnifiedInput({
  text,
  onTextChange,
  images,
  onAddImages,
  onRemoveImage,
  disabled,
}: {
  text: string;
  onTextChange: (v: string) => void;
  images: string[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (idx: number) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);

  const handlePaste = (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) {
      e.preventDefault();
      onAddImages(files);
    }
    // else: let the default textarea paste behaviour proceed (URLs as text)
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDrag(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer?.files || []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (files.length > 0) onAddImages(files);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={handleDrop}
      className={`rounded-lg border-2 border-dashed p-3 transition ${
        drag
          ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
          : 'border-zinc-300 bg-white dark:border-zinc-700 dark:bg-zinc-950'
      } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
    >
      {images.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div
              key={i}
              className="group relative h-16 w-16 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={`upload ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                className="absolute left-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                aria-label={`حذف الصورة ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onPaste={handlePaste}
        rows={4}
        placeholder="الصق روابط AliExpress، أو الصق صور المنتج (⌘V / Ctrl+V)، أو اسحب الصور إلى هنا"
        className="ltr block w-full resize-y bg-transparent p-1 font-mono text-xs outline-none placeholder:text-zinc-400"
        dir="ltr"
        disabled={disabled}
      />

      <div className="mt-2 flex items-center justify-between border-t border-dashed border-zinc-200 pt-2 text-xs text-zinc-500 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
          disabled={disabled}
        >
          <Upload className="h-3.5 w-3.5" />
          اختر صورًا
        </button>
        {images.length > 0 && (
          <span>
            {images.length} {images.length === 1 ? 'صورة' : 'صور'}
          </span>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const files = Array.from(e.target.files || []);
          if (files.length > 0) onAddImages(files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [products, setProducts] = useState<ProductState[]>(() => [newProduct(1)]);
  const [byok, setByok] = useState<ByokState | null>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [quota, setQuota] = useState<{ used: number; remaining: number } | null>(null);

  // Load BYOK from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BYOK_STORAGE_KEY);
      if (raw) setByok(JSON.parse(raw));
    } catch {
      /* corrupt — ignore */
    }
  }, []);

  // Fetch quota on mount and whenever BYOK changes (quota doesn't apply under BYOK).
  useEffect(() => {
    if (byok) {
      setQuota(null);
      return;
    }
    fetch('/api/generate')
      .then((r) => r.json())
      .then((data) => {
        if (data?.quota) setQuota({ used: data.quota.used, remaining: data.quota.remaining });
      })
      .catch(() => {
        /* non-fatal */
      });
  }, [byok]);

  const persistByok = useCallback((next: ByokState | null) => {
    setByok(next);
    try {
      if (next) localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(BYOK_STORAGE_KEY);
    } catch {
      /* storage disabled — in-memory still works this session */
    }
  }, []);

  const updateProduct = useCallback((id: string, patch: Partial<ProductState>) => {
    setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const addProduct = () => setProducts((ps) => [...ps, newProduct(ps.length + 1)]);

  const removeProduct = (id: string) =>
    setProducts((ps) => (ps.length > 1 ? ps.filter((p) => p.id !== id) : ps));

  const addImagesTo = async (id: string, files: File[]) => {
    const current = products.find((p) => p.id === id);
    if (!current) return;
    const room = Math.max(0, 10 - current.images.length);
    const accepted = files.slice(0, room);
    const resized = await Promise.all(
      accepted.map(async (f) => {
        try {
          return await fileToResizedDataUrl(f);
        } catch {
          return null;
        }
      }),
    );
    const valid = resized.filter((x): x is string => !!x);
    updateProduct(id, { images: [...current.images, ...valid] });
  };

  const generate = async (id: string) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const urls = parseUrls(p.text);
    if (urls.length === 0 && p.images.length === 0) {
      updateProduct(id, { error: 'أضف رابطًا واحدًا على الأقل أو صورة واحدة.' });
      return;
    }
    updateProduct(id, { loading: true, error: null });

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (byok) {
        headers['x-byok-provider'] = byok.provider;
        headers['x-byok-key'] = byok.key;
        if (byok.model) headers['x-byok-model'] = byok.model;
      }
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls, images: p.images, note: p.note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        updateProduct(id, {
          loading: false,
          error: data?.message || 'حدث خطأ. حاول مرة أخرى.',
        });
        if (typeof data?.used === 'number') {
          setQuota({ used: data.used, remaining: Math.max(0, data.remaining ?? 0) });
        }
        return;
      }
      updateProduct(id, { loading: false, error: null, result: data.listing });
      if (data?.meta?.quota) {
        setQuota({ used: data.meta.quota.used, remaining: data.meta.quota.remaining });
      }
    } catch (err) {
      updateProduct(id, {
        loading: false,
        error: err instanceof Error ? err.message : 'خطأ في الشبكة.',
      });
    }
  };

  const generateAll = async () => {
    for (const p of products) {
      if (!p.loading && !p.result) {
        // eslint-disable-next-line no-await-in-loop
        await generate(p.id);
      }
    }
  };

  const completedCount = products.filter((p) => !!p.result).length;

  const exportCsv = () => {
    const rows: ProductRow[] = products
      .filter((p) => !!p.result)
      .map((p) => ({
        name: p.name,
        urls: parseUrls(p.text),
        listing: p.result as Listing,
      }));
    if (rows.length === 0) return;
    const csv = productsToCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`noon-listings-${stamp}.csv`, csv);
  };

  const quotaLabel = useMemo(() => {
    if (byok) return 'غير محدود (مفتاحك)';
    if (!quota) return null;
    if (quota.remaining <= 0) return 'انتهت التجارب المجانية';
    return `${quota.remaining} من 10 تجارب مجانية`;
  }, [byok, quota]);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 text-zinc-900">
              <Zap className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <h1 className="text-base font-semibold">مولد أوصاف منتجات نون</h1>
              <p className="text-xs text-zinc-500 ltr">by The360Squad</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {quotaLabel && (
              <span className="hidden rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 sm:inline">
                {quotaLabel}
              </span>
            )}
            <button
              type="button"
              onClick={() => setByokOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {byok ? <KeyRound className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
              {byok ? 'مفتاحك' : 'الإعدادات'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Intro */}
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
          <h2 className="mb-1 text-lg font-semibold">أنشئ قوائم جاهزة لنون</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            الصق روابط AliExpress أو ألصق صور المنتج. ستحصل على عنوان ووصف و5 ميزات متوافقة مع نون — بالعربية والإنجليزية. أضف منتجات أخرى ثم صدّر الكل كملف CSV واحد.
          </p>
        </section>

        {/* Quota exhausted hint */}
        {!byok && quota && quota.remaining === 0 && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>انتهت التجارب المجانية.</strong> استخدمت جميع التجارب العشر.{' '}
            <button
              type="button"
              onClick={() => setByokOpen(true)}
              className="underline underline-offset-2"
            >
              أضف مفتاح API الخاص بك
            </button>{' '}
            للاستمرار — يُحفظ في متصفحك ويمنحك إنشاءات غير محدودة على حسابك.
          </div>
        )}

        {/* Product cards */}
        <div className="space-y-4">
          {products.map((p, idx) => (
            <article
              key={p.id}
              className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
            >
              <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <input
                  type="text"
                  value={p.name}
                  onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                  className="flex-1 bg-transparent text-sm font-semibold outline-none"
                  aria-label="اسم المنتج"
                />
                {products.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeProduct(p.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                    aria-label={`حذف المنتج ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </header>

              <div className="space-y-3 p-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    الروابط والصور
                  </label>
                  <UnifiedInput
                    text={p.text}
                    onTextChange={(v) => updateProduct(p.id, { text: v })}
                    images={p.images}
                    onAddImages={(files) => addImagesTo(p.id, files)}
                    onRemoveImage={(i) =>
                      updateProduct(p.id, { images: p.images.filter((_, idx2) => idx2 !== i) })
                    }
                    disabled={p.loading}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    ملاحظة (اختياري)
                  </label>
                  <textarea
                    value={p.note}
                    onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                    rows={2}
                    placeholder="مثال: السوق المستهدف السعودية، نساء 25-40، سعر حوالي 89 ريال"
                    className="block w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1 text-xs text-zinc-500">
                  {p.error && <span className="text-red-600">{p.error}</span>}
                  {!p.error && p.result && <span className="text-emerald-600">تم الإنشاء ✓</span>}
                </div>
                <button
                  type="button"
                  onClick={() => generate(p.id)}
                  disabled={p.loading}
                  className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
                >
                  {p.loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : p.result ? (
                    'إعادة الإنشاء'
                  ) : (
                    'أنشئ'
                  )}
                </button>
              </div>

              {/* Result panel — Arabic first (primary audience), English second */}
              {p.result && (
                <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
                  <CodeBlock label="العربية — العنوان" text={p.result.ar.title} direction="rtl" />
                  <CodeBlock
                    label="العربية — الوصف والميزات"
                    text={renderListingAr(p.result)}
                    direction="rtl"
                  />
                  <CodeBlock label="English — Title" text={p.result.en.title} direction="ltr" />
                  <CodeBlock
                    label="English — Description + Features"
                    text={renderListingEn(p.result)}
                    direction="ltr"
                  />
                </div>
              )}
            </article>
          ))}
        </div>

        {/* Footer actions */}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={addProduct}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            <Plus className="h-4 w-4" />
            أضف منتجًا آخر
          </button>

          <button
            type="button"
            onClick={generateAll}
            disabled={products.every((p) => p.loading || !!p.result)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            أنشئ الكل
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={exportCsv}
            disabled={completedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            تصدير {completedCount > 0 ? `${completedCount} ` : ''}إلى CSV
          </button>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-500">
          يلتزم بقواعد نون: لا رموز تعبيرية في الأوصاف أو النقاط، عناوين 20–200 حرف، 5 ميزات بحد أقصى 250 حرفًا. <span className="ltr">Powered by Claude Haiku 4.5 (default)</span>
        </footer>
      </main>

      {byokOpen && (
        <ByokModal initial={byok} onSave={persistByok} onClose={() => setByokOpen(false)} />
      )}
    </div>
  );
}
