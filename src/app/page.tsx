'use client';

import {
  ChangeEvent,
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

type ByokProvider = 'anthropic' | 'google';
type ByokState = { provider: ByokProvider; key: string } | null;

interface ProductState {
  id: string;
  name: string;
  urls: string;
  note: string;
  images: string[]; // resized JPEG data URLs
  result: Listing | null;
  loading: boolean;
  error: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const BYOK_STORAGE_KEY = 'noon-desc.byok.v1';

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
    name: `Product ${idx}`,
    urls: '',
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
          // Clipboard API blocked in some iframes / HTTP. Fall back silently.
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-md bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({
  label,
  text,
  rtl,
}: {
  label: string;
  text: string;
  rtl?: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>{label}</span>
        <CopyButton getText={() => text} />
      </div>
      <pre
        className={`whitespace-pre-wrap break-words p-3 text-sm leading-6 text-zinc-800 dark:text-zinc-200 ${
          rtl ? 'rtl' : ''
        }`}
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

function ByokModal({
  initial,
  onSave,
  onClose,
}: {
  initial: ByokState;
  onSave: (value: ByokState) => void;
  onClose: () => void;
}) {
  const [provider, setProvider] = useState<ByokProvider>(initial?.provider ?? 'anthropic');
  const [key, setKey] = useState(initial?.key ?? '');
  const [show, setShow] = useState(false);

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
          <h2 className="text-lg font-semibold">Bring your own API key</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
          Paste an Anthropic or Google API key to get unlimited generations on your own quota.
          The key is saved in your browser only — it is sent to our server only as a pass-through
          for this request, never stored.
        </p>

        <label className="mb-3 block text-sm font-medium">
          Provider
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as ByokProvider)}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="anthropic">Anthropic (Claude Haiku 4.5)</option>
            <option value="google">Google (Gemini 2.5 Flash)</option>
          </select>
        </label>

        <label className="mb-2 block text-sm font-medium">
          API key
          <div className="relative mt-1">
            <input
              type={show ? 'text' : 'password'}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={provider === 'anthropic' ? 'sk-ant-...' : 'AIza...'}
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pr-16 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-900"
              autoComplete="off"
              spellCheck={false}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>
        <p className="mb-5 text-xs text-zinc-500">
          {provider === 'anthropic' ? (
            <>
              Get a key at{' '}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                console.anthropic.com
              </a>
              .
            </>
          ) : (
            <>
              Get a key at{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                aistudio.google.com
              </a>{' '}
              — free tier available.
            </>
          )}
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
            Clear key
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!key.trim()}
              onClick={() => {
                onSave({ provider, key: key.trim() });
                onClose();
              }}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageDropZone({
  images,
  onAdd,
  onRemove,
  disabled,
}: {
  images: string[];
  onAdd: (files: File[]) => void;
  onRemove: (idx: number) => void;
  disabled?: boolean;
}) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    onAdd(Array.from(files).filter((f) => f.type.startsWith('image/')));
  };

  return (
    <div>
      <div
        onDragOver={(e: DragEvent) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          setDrag(false);
          if (disabled) return;
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-6 text-sm transition ${
          drag
            ? 'border-zinc-900 bg-zinc-100 dark:border-zinc-100 dark:bg-zinc-900'
            : 'border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-zinc-600'
        } ${disabled ? 'pointer-events-none opacity-50' : ''}`}
      >
        <Upload className="mb-1 h-5 w-5 text-zinc-400" />
        <span className="text-zinc-600 dark:text-zinc-400">
          Drop product images here, or click to browse
        </span>
        <span className="mt-0.5 text-xs text-zinc-400">
          JPEG or PNG — resized automatically to 1280px
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            handleFiles(e.target.files);
            e.target.value = ''; // allow re-selecting the same file
          }}
        />
      </div>
      {images.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {images.map((img, i) => (
            <div
              key={i}
              className="group relative h-20 w-20 overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img} alt={`upload ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-0.5 top-0.5 rounded bg-black/60 p-0.5 text-white opacity-0 transition group-hover:opacity-100"
                aria-label={`Remove image ${i + 1}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [products, setProducts] = useState<ProductState[]>(() => [newProduct(1)]);
  const [byok, setByok] = useState<ByokState>(null);
  const [byokOpen, setByokOpen] = useState(false);
  const [quota, setQuota] = useState<{ used: number; remaining: number } | null>(null);

  // Load BYOK from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BYOK_STORAGE_KEY);
      if (raw) setByok(JSON.parse(raw));
    } catch {
      /* corrupt JSON — ignore, user can re-enter */
    }
  }, []);

  // Fetch quota on mount and whenever BYOK state changes (quota irrelevant if BYOK active).
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
        /* non-fatal — UI will just not show a quota indicator */
      });
  }, [byok]);

  const persistByok = useCallback((next: ByokState) => {
    setByok(next);
    try {
      if (next) localStorage.setItem(BYOK_STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(BYOK_STORAGE_KEY);
    } catch {
      /* storage may be disabled (Safari private mode) — in-memory still works */
    }
  }, []);

  const updateProduct = useCallback(
    (id: string, patch: Partial<ProductState>) => {
      setProducts((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    },
    [],
  );

  const addProduct = () =>
    setProducts((ps) => [...ps, newProduct(ps.length + 1)]);

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
    const urls = parseUrls(p.urls);
    if (urls.length === 0 && p.images.length === 0) {
      updateProduct(id, { error: 'Add at least one URL or one image.' });
      return;
    }
    updateProduct(id, { loading: true, error: null });

    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (byok) {
        headers['x-byok-provider'] = byok.provider;
        headers['x-byok-key'] = byok.key;
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
          error: data?.message || 'Something went wrong. Try again.',
        });
        // Sync quota display — a quota_exhausted response tells us where we are.
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
        error: err instanceof Error ? err.message : 'Network error.',
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
        urls: parseUrls(p.urls),
        listing: p.result as Listing,
      }));
    if (rows.length === 0) return;
    const csv = productsToCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`noon-listings-${stamp}.csv`, csv);
  };

  const quotaLabel = useMemo(() => {
    if (byok) return 'Unlimited (your key)';
    if (!quota) return null;
    if (quota.remaining <= 0) return '0 free left — add a key to continue';
    return `${quota.remaining} of 10 free left`;
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
              <h1 className="text-base font-semibold">Noon Product Description</h1>
              <p className="text-xs text-zinc-500">by The360Squad</p>
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
              {byok ? 'Your key' : 'Settings'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* Intro */}
        <section className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950 sm:p-5">
          <h2 className="mb-1 text-lg font-semibold">Generate Noon-ready listings</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Paste AliExpress URLs or drop product images. You get a Noon-compliant title,
            description, and 5 feature bullets — in both English and Arabic. Add more products,
            then export everything as one CSV.
          </p>
        </section>

        {/* Quota exhausted hint */}
        {!byok && quota && quota.remaining === 0 && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
            <strong>Free quota reached.</strong> You&apos;ve used all 10 free generations.{' '}
            <button
              type="button"
              onClick={() => setByokOpen(true)}
              className="underline underline-offset-2"
            >
              Add your own API key
            </button>{' '}
            to continue — it stays in your browser and gives you unlimited generations on your own quota.
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
                  aria-label="Product name"
                />
                {products.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeProduct(p.id)}
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-900"
                    aria-label={`Remove product ${idx + 1}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </header>

              <div className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    AliExpress URLs (one per line)
                  </label>
                  <textarea
                    value={p.urls}
                    onChange={(e) => updateProduct(p.id, { urls: e.target.value })}
                    rows={4}
                    placeholder="https://www.aliexpress.com/item/..."
                    className="block w-full resize-y rounded-md border border-zinc-300 bg-white p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <label className="mt-3 mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Note (optional)
                  </label>
                  <textarea
                    value={p.note}
                    onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                    rows={2}
                    placeholder="e.g. Target: Saudi market, women 25-40, price sweet spot 89 SAR"
                    className="block w-full resize-y rounded-md border border-zinc-300 bg-white p-2 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
                    Product images (up to 10)
                  </label>
                  <ImageDropZone
                    images={p.images}
                    onAdd={(files) => addImagesTo(p.id, files)}
                    onRemove={(i) =>
                      updateProduct(p.id, { images: p.images.filter((_, idx2) => idx2 !== i) })
                    }
                    disabled={p.loading}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
                <div className="min-w-0 flex-1 text-xs text-zinc-500">
                  {p.error && <span className="text-red-600">{p.error}</span>}
                  {!p.error && p.result && <span className="text-emerald-600">Generated ✓</span>}
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
                    'Regenerate'
                  ) : (
                    'Generate'
                  )}
                </button>
              </div>

              {/* Result panel */}
              {p.result && (
                <div className="space-y-3 border-t border-zinc-200 p-4 dark:border-zinc-800">
                  <CodeBlock label="English — Title" text={p.result.en.title} />
                  <CodeBlock label="English — Description + Features" text={renderListingEn(p.result)} />
                  <CodeBlock label="العربية — العنوان" text={p.result.ar.title} rtl />
                  <CodeBlock label="العربية — الوصف والميزات" text={renderListingAr(p.result)} rtl />
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
            Add another product
          </button>

          <button
            type="button"
            onClick={generateAll}
            disabled={products.every((p) => p.loading || !!p.result)}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Generate all pending
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={exportCsv}
            disabled={completedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            Export {completedCount > 0 ? `${completedCount} ` : ''}to CSV
          </button>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-500">
          Noon compliance rules enforced: no emojis in descriptions/bullets, 20-200 char titles,
          5 features capped at 250 chars each. Powered by Claude Haiku 4.5.
        </footer>
      </main>

      {byokOpen && (
        <ByokModal
          initial={byok}
          onSave={persistByok}
          onClose={() => setByokOpen(false)}
        />
      )}
    </div>
  );
}
