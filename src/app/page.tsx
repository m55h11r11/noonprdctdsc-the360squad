'use client';

import {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight,
  Check,
  Cloud,
  CloudOff,
  Copy,
  Download,
  KeyRound,
  Loader2,
  LogOut,
  Plus,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import { fileToResizedDataUrl } from '@/lib/image';
import { downloadCsv, productsToCsv, type ProductRow } from '@/lib/csv';
import { ListingSchema, type Listing } from '@/lib/schema';
import { BYOK_PROVIDERS, PROVIDER_META, type ByokProvider } from '@/lib/providers-meta';
import { getSupabase, supabaseConfigured } from '@/lib/supabase/client';
import { RESTORE_RECENT_COUNT } from '@/lib/config';
import type { Session, User } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────
// ByokProvider is imported from providers-meta — single source of truth
// (was previously redeclared as a literal union; removed to prevent drift).

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
  fromCloud?: boolean; // true if restored from Supabase; images were not persisted server-side
  result: Listing | null;
  loading: boolean;
  error: string | null;
}

// Derived from the single source of truth in src/lib/providers-meta.ts.
// Order is preserved by iterating BYOK_PROVIDERS (a const tuple).
const PROVIDER_OPTIONS: Array<{
  id: ByokProvider;
  label: string;
  defaultModel: string;
  keysUrl: string;
  hint: string;
}> = BYOK_PROVIDERS.map((id) => ({
  id,
  label: PROVIDER_META[id].label,
  defaultModel: PROVIDER_META[id].defaultModel,
  keysUrl: PROVIDER_META[id].docsUrl,
  hint: PROVIDER_META[id].keyHint,
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const BYOK_STORAGE_KEY = 'noon-desc.byok.v2'; // v2: added optional `model`
// Stashed across the Google OAuth redirect so the bootstrap effect on the
// post-callback page knows which anon user_id to re-parent listings from.
// localStorage (not sessionStorage) because some browsers clear sessionStorage
// during cross-origin redirects; localStorage survives. We delete the value
// the moment migration completes (or fails), so it never lingers.
const PENDING_ANON_MIGRATE_KEY = 'noon-desc.migrate.anon-id';

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

// ─── Quick key input (onboarding inline) ────────────────────────────────────
// Detects the provider from the key's prefix so the user just pastes-and-goes.
// If the prefix isn't recognised, we bail out to the full Settings modal so
// they can pick the provider manually.

function detectProvider(key: string): ByokProvider | null {
  const k = key.trim();
  if (k.length < 10) return null;
  if (k.startsWith('AIza')) return 'google';
  if (k.startsWith('sk-ant-')) return 'anthropic';
  if (k.startsWith('sk-or-')) return 'openrouter';
  if (k.startsWith('gsk_')) return 'groq';
  if (k.startsWith('sk-')) return 'openai'; // after sk-ant / sk-or checks above
  return null; // unknown (e.g. Mistral hex) → fall through to full modal
}

function QuickKeyInput({
  onSaved,
  onOpenFull,
}: {
  onSaved: (value: ByokState) => void;
  onOpenFull: () => void;
}) {
  const [key, setKey] = useState('');
  const [show, setShow] = useState(false);
  const trimmed = key.trim();
  const detected = detectProvider(trimmed);
  const meta = detected ? PROVIDER_OPTIONS.find((p) => p.id === detected) : null;

  const submit = () => {
    if (trimmed.length < 10) return;
    if (!detected) {
      // Unknown prefix — open the full modal so they can pick manually.
      onOpenFull();
      return;
    }
    onSaved({ provider: detected, key: trimmed });
  };

  return (
    <div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="2. ألصق المفتاح هنا (AIza... / sk-ant-... / sk-... / gsk_...)"
            className="ltr block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 pl-16 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            dir="ltr"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute left-2 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            tabIndex={-1}
          >
            {show ? 'إخفاء' : 'إظهار'}
          </button>
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={trimmed.length < 10}
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          ابدأ
        </button>
      </div>
      {/* Provider hint */}
      <div className="mt-1.5 text-xs">
        {meta ? (
          <span className="text-emerald-700 dark:text-emerald-400">
            ✓ تم اكتشاف: <strong>{meta.label}</strong> — اضغط &quot;ابدأ&quot;
          </span>
        ) : trimmed.length > 0 && trimmed.length < 10 ? (
          <span className="text-zinc-500">المفتاح قصير جدًا…</span>
        ) : trimmed.length >= 10 ? (
          <span className="text-amber-700 dark:text-amber-400">
            ⚠ لم نتعرف على المزود — اضغط &quot;ابدأ&quot; لاختياره يدويًا
          </span>
        ) : (
          <span className="text-zinc-500 ltr">
            Gemini keys start with <code>AIza</code>. Other providers work too.
          </span>
        )}
      </div>
    </div>
  );
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
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-md rounded-2xl border border-[color:var(--border-stronger)] bg-[color:var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">استخدم مفتاح API خاص بك</h2>
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
              className="btn-noon rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              حفظ
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
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
        placeholder="الصق روابط المنتج من أي موقع (AliExpress / Amazon / Shopify / Salla / أي مصدر)، أو صور المنتج (⌘V / Ctrl+V)، أو اسحب الصور هنا"
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

// ─── Sync modal (cloud save + cross-device via Google) ─────────────────────
// Deliberately tiny. First-visit visitors never see this — the button that
// opens it is hidden until the user has saved at least one listing. Once
// they've invested in the tool (saved something), the cloud option becomes
// available as an opt-in for cross-device sync. No banners, no interrupts.

function SyncModal({
  user,
  onClose,
  onSignIn,
  onSignOut,
  onDeleteAll,
  signOutPending,
  oauthError,
}: {
  user: User | null;
  onClose: () => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onDeleteAll: () => void;
  signOutPending: boolean;
  oauthError: string | null;
}) {
  const isSignedIn = !!user && !user.is_anonymous;
  const email = user?.email ?? '';

  // Esc dismiss — match ConfirmDeleteAllModal behavior. Blocked while a
  // sign-out drain is mid-flight (handlers would re-render against a
  // half-torn-down session).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !signOutPending) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, signOutPending]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm ${
        signOutPending ? 'cursor-wait' : ''
      }`}
      onClick={() => {
        // Block dismiss while sign-out is mid-drain — closing here would
        // leave the modal in an inconsistent state (handlers still firing).
        if (!signOutPending) onClose();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-sm rounded-2xl border border-[color:var(--border-stronger)] bg-[color:var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold tracking-tight">المزامنة عبر الأجهزة</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={signOutPending}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isSignedIn ? (
          <>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              مسجّل الدخول بحساب Google:{' '}
              <strong className="ltr inline-block font-mono text-xs">{email}</strong>
              <br />
              قوائمك تُحفظ تلقائيًا وستتبعك على أي جهاز تدخل فيه بنفس الحساب.
            </p>
            <div className="space-y-2">
              <button
                type="button"
                onClick={onSignOut}
                disabled={signOutPending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {signOutPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جارٍ حفظ آخر العناصر…
                  </>
                ) : (
                  <>
                    <LogOut className="h-4 w-4" />
                    تسجيل الخروج من هذا الجهاز
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onDeleteAll}
                disabled={signOutPending}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-4 w-4" />
                حذف جميع بياناتي
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
              قوائمك محفوظة على هذا الجهاز فقط. سجّل الدخول بحساب Google لتحصل عليها على جميع أجهزتك تلقائيًا.
            </p>
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-white border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 shadow-sm dark:border-zinc-700 dark:bg-zinc-100"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.83z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83c.87-2.6 3.3-4.52 6.16-4.52z"
                  fill="#EA4335"
                />
              </svg>
              تسجيل الدخول بحساب Google
            </button>
            {oauthError && (
              <p
                role="alert"
                className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
              >
                {oauthError}
              </p>
            )}
            <button
              type="button"
              onClick={onDeleteAll}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
              حذف بياناتي من السحابة
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

// ─── Confirm-delete-all modal ───────────────────────────────────────────────
// Replaces window.confirm() — the native dialog uses the browser's locale (so
// it appears in English buttons / non-RTL on most machines), can't be styled,
// and feels glaringly out of place in this Arabic-first app. Matches SyncModal
// visually so the destructive moment doesn't feel jarring.

function ConfirmDeleteAllModal({
  onConfirm,
  onCancel,
  pending,
  error,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
  error: string | null;
}) {
  // Esc dismisses unless a delete is already in flight (don't let the user
  // close the modal during the network call — they'd lose feedback).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, pending]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!pending) onCancel();
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.97 }}
        transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
        className="w-full max-w-sm rounded-2xl border border-[color:var(--border-stronger)] bg-[color:var(--surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2
            id="confirm-delete-title"
            className="text-base font-semibold text-red-600 dark:text-red-400"
          >
            حذف جميع بياناتي؟
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-50 dark:hover:bg-zinc-800"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          سيتم حذف جميع قوائمك المحفوظة في السحابة نهائيًا. لا يمكن التراجع عن هذا الإجراء.
        </p>
        {error && (
          <p
            role="alert"
            className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
          >
            <Trash2 className="h-4 w-4" />
            {pending ? 'جارٍ الحذف…' : 'نعم، احذف كل شيء'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function Home() {
  const [products, setProducts] = useState<ProductState[]>(() => [newProduct(1)]);
  const [byok, setByok] = useState<ByokState | null>(null);
  const [byokOpen, setByokOpen] = useState(false);

  // Cloud sync state. These only matter when Supabase is configured on the
  // deployment. If it's not, cloudReady stays false and the ☁️ button never
  // appears — the app behaves exactly like it did before cloud sync shipped.
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  // ConfirmDeleteAllModal visibility. Separate from `deletePending` because the
  // modal stays mounted (showing "جارٍ الحذف…") while the DELETE round-trips.
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  // Surfaced inside ConfirmDeleteAllModal when the DELETE itself fails. Without
  // this, a 500 from the server gets swallowed and the user sees the modal
  // close as if the wipe succeeded — but their cloud rows are still there.
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Sign-out runs an async drain of pendingSaves, then signOut, then a fresh
  // signInAnonymously — that can take a noticeable beat on slow networks. We
  // surface it inside SyncModal so the user sees "جارٍ الحفظ ثم الخروج…" instead
  // of a frozen UI. Falls through to the existing modal close once done.
  const [signOutPending, setSignOutPending] = useState(false);
  // Brief success message shown via aria-live region after silent destructive
  // / migration actions (delete-all, anon→Google migration). Auto-clears
  // after 3.5s. Without this the user clicks a destructive button and sees
  // nothing — the action might as well not have happened from their POV.
  const [cloudActionToast, setCloudActionToast] = useState<string | null>(null);
  useEffect(() => {
    if (!cloudActionToast) return;
    const t = setTimeout(() => setCloudActionToast(null), 3500);
    return () => clearTimeout(t);
  }, [cloudActionToast]);
  // Inline error shown under the Google sign-in button if signInWithOAuth
  // throws (network down, popup blocked, etc.). Cleared whenever the modal
  // re-opens — stale errors shouldn't haunt a fresh attempt.
  const [oauthError, setOauthError] = useState<string | null>(null);
  // Tracks product IDs whose generate() call is in flight. Used to short-
  // circuit double-clicks before React's loading=true state has propagated.
  const inFlight = useRef<Set<string>>(new Set());
  // Tracks fire-and-forget POST /api/listings promises so handleSignOut can
  // drain them before discarding the current user_id. Without this, a row
  // saved while sign-out is in progress lands under the about-to-be-discarded
  // anonymous user_id and becomes orphaned (invisible under RLS).
  const pendingSaves = useRef<Set<Promise<unknown>>>(new Set());
  // Latest cloudUser exposed to the onAuthStateChange handler — that handler
  // is registered in a `[]`-deps effect so it captures the initial null. The
  // ref lets the handler detect "previous session was anonymous" without
  // re-subscribing on every cloudUser change.
  const cloudUserRef = useRef<User | null>(null);
  useEffect(() => {
    cloudUserRef.current = cloudUser;
  }, [cloudUser]);
  // True while sign-out / delete-all are tearing down the session. New saves
  // started during this window would land under the about-to-be-discarded
  // user_id (drainPendingSaves only awaits the snapshot it took at start).
  // We refuse to add them to pendingSaves and skip the cloud POST entirely.
  const destructiveActive = useRef(false);

  // Load BYOK from localStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(BYOK_STORAGE_KEY);
      if (raw) setByok(JSON.parse(raw));
    } catch {
      /* corrupt — ignore */
    }
  }, []);

  // Cloud session bootstrap.
  //   1. If Supabase is wired up, get the current session (Google user, anon
  //      user, or none).
  //   2. If there is no session, sign in anonymously — this is silent, takes
  //      ~200ms, and gives us a user_id to scope saves by.
  //   3. Once a session exists, fetch the user's recent listings. If any are
  //      found, replace the default blank product with those cards (result
  //      already populated) plus a trailing blank card so the user can still
  //      start fresh.
  useEffect(() => {
    if (!supabaseConfigured) return;
    const supabase = getSupabase();
    if (!supabase) return;

    let cancelled = false;

    (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      let user = sessionData.session?.user ?? null;

      if (!user) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.warn('[cloud] anonymous sign-in failed — cloud features off for this session:', error.message);
          return;
        }
        user = data.user ?? null;
      }
      if (cancelled) return;
      setCloudUser(user);
      setCloudReady(true);

      // If we just landed back from a Google OAuth redirect AND we stashed
      // an anon user_id before leaving, re-parent the user's anon listings
      // to the new Google identity. Best-effort: a failure (e.g. expired
      // JWT racing the bootstrap) leaves the key in place so the next page
      // load can retry. The server SQL guard rejects unsafe re-parents.
      try {
        const pendingAnonId = localStorage.getItem(PENDING_ANON_MIGRATE_KEY);
        if (pendingAnonId && user && !user.is_anonymous && pendingAnonId !== user.id) {
          let migrateRes: Response | null = null;
          try {
            migrateRes = await fetch('/api/listings/migrate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ anonUserId: pendingAnonId }),
            });
          } catch {
            /* network error — leave the key for next bootstrap to retry */
          }
          if (migrateRes && migrateRes.ok) {
            // Clear the key only on confirmed success — a 401 from a stale
            // JWT or a 503 from cold cloud should NOT eat our retry option.
            try {
              localStorage.removeItem(PENDING_ANON_MIGRATE_KEY);
            } catch {
              /* storage disabled */
            }
            try {
              const payload = (await migrateRes.json()) as { moved?: number };
              const moved = typeof payload.moved === 'number' ? payload.moved : 0;
              if (moved > 0) {
                setCloudActionToast(`تم نقل ${moved} من قوائمك إلى حسابك.`);
              } else {
                setCloudActionToast('تم ربط حسابك بنجاح.');
              }
            } catch {
              setCloudActionToast('تم ربط حسابك بنجاح.');
            }
          }
        } else if (pendingAnonId) {
          // Stale key but no usable session for it — clear so it doesn't
          // linger across future sign-ins.
          try {
            localStorage.removeItem(PENDING_ANON_MIGRATE_KEY);
          } catch {
            /* storage disabled */
          }
        }
      } catch {
        /* storage disabled — nothing to do */
      }

      // Pull recent listings to decide whether to show the ☁️ button and
      // whether to restore past work into the UI.
      try {
        const res = await fetch('/api/listings');
        if (!res.ok) return;
        const payload = await res.json();
        // result is typed as `unknown` deliberately — the API filters bad
        // rows but we don't trust the wire blindly (cached responses, future
        // schema drift, etc.). Validate at use site via flatMap so any row
        // that fails just gets dropped instead of crashing the page.
        const items: Array<{
          id: number;
          name: string;
          source_urls: string[];
          note: string | null;
          result: unknown;
        }> = payload.items ?? [];
        if (items.length > 0 && !cancelled) {
          const restored: ProductState[] = items
            .slice(0, RESTORE_RECENT_COUNT)
            .flatMap((it) => {
              const parsed = ListingSchema.safeParse(it.result);
              if (!parsed.success) return [];
              return [{
                id: uid(),
                name: it.name,
                text: (it.source_urls ?? []).join('\n'),
                note: it.note ?? '',
                images: [], // images aren't persisted server-side; see README design note
                fromCloud: true,
                result: parsed.data,
                loading: false,
                error: null,
              } satisfies ProductState];
            });
          if (restored.length > 0) {
            // Restored cards first, then a blank one so the user can keep going.
            setProducts([...restored, newProduct(restored.length + 1)]);
          }
        }
      } catch {
        /* non-fatal — user keeps working locally */
      }
    })();

    // Subscribe to auth state changes so the UI updates after Google sign-in.
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        setCloudUser(session?.user ?? null);
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

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
    const resized = await Promise.all(
      files.map(async (f) => {
        try {
          return await fileToResizedDataUrl(f);
        } catch {
          return null;
        }
      }),
    );
    const valid = resized.filter((x): x is string => !!x);
    if (!valid.length) return;
    // Functional setState so we don't clobber edits the user made (typing,
    // removing other images) while the async resize was in flight.
    setProducts((ps) =>
      ps.map((p) => {
        if (p.id !== id) return p;
        const room = Math.max(0, 10 - p.images.length);
        return { ...p, images: [...p.images, ...valid.slice(0, room)] };
      }),
    );
  };

  const generate = async (id: string) => {
    // Synchronous guard against double-clicks. React state updates are async
    // so a fast second click can fire before `loading=true` propagates —
    // both calls would burn the user's BYOK quota and race on setResult.
    if (inFlight.current.has(id)) return;
    const p = products.find((x) => x.id === id);
    if (!p) return;
    if (!byok) {
      updateProduct(id, { error: 'أضف مفتاح API في الإعدادات أولًا.' });
      setByokOpen(true);
      return;
    }
    const urls = parseUrls(p.text);
    if (urls.length === 0 && p.images.length === 0) {
      updateProduct(id, { error: 'أضف رابطًا واحدًا على الأقل أو صورة واحدة.' });
      return;
    }
    inFlight.current.add(id);
    // Clear any prior result so a failed retry doesn't leave the old success
    // panel sitting next to a fresh red error.
    updateProduct(id, { loading: true, error: null, result: null });

    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'x-byok-provider': byok.provider,
        'x-byok-key': byok.key,
      };
      if (byok.model) headers['x-byok-model'] = byok.model;
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers,
        body: JSON.stringify({ urls, images: p.images, note: p.note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        // If the server reports byok_required (stale key, wiped localStorage,
        // etc.) reopen the settings modal so the user can re-enter one.
        if (data?.error === 'byok_required') {
          setByokOpen(true);
        }
        updateProduct(id, {
          loading: false,
          error: data?.message || 'حدث خطأ. حاول مرة أخرى.',
        });
        return;
      }
      updateProduct(id, { loading: false, error: null, result: data.listing });

      // Fire-and-forget save to Supabase. We deliberately don't await or
      // surface errors to the user — the listing is already in their UI,
      // saving is a bonus. If it fails we lose a row but the user's session
      // isn't affected. Keeps the "not first on sight" promise: no toast,
      // no loading spinner, no error popup for the save path.
      //
      // SKIP CONDITIONS:
      //   1. destructiveActive — sign-out / delete-all is mid-flight, this
      //      save would land under a discarded user_id (orphan).
      //   2. p.fromCloud — the listing was restored from a previous cloud
      //      row; persisting again would create a duplicate. The schema has
      //      no UPDATE policy on purpose (we keep history) so we just skip.
      if (
        cloudReady &&
        supabaseConfigured &&
        !destructiveActive.current &&
        !p.fromCloud
      ) {
        const meta = data?.meta ?? {};
        const savePromise = fetch('/api/listings', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: p.name,
            sourceUrls: urls,
            note: p.note || null,
            provider: meta.provider ?? null,
            modelId: meta.modelId ?? null,
            imageCount: p.images.length,
            generationMs: typeof meta.generationMs === 'number' ? meta.generationMs : null,
            listing: data.listing,
          }),
        }).catch(() => {
          /* non-fatal */
        });
        // Track so handleSignOut can drain before discarding user_id.
        pendingSaves.current.add(savePromise);
        savePromise.finally(() => {
          pendingSaves.current.delete(savePromise);
        });
      }
    } catch (err) {
      updateProduct(id, {
        loading: false,
        error: err instanceof Error ? err.message : 'خطأ في الشبكة.',
      });
    } finally {
      inFlight.current.delete(id);
    }
  };

  // Cloud sync handlers — passed to SyncModal.
  const handleGoogleSignIn = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setOauthError(null);
    // Stash the current anon user_id so the post-redirect bootstrap can
    // re-parent the user's listings from the anon row to the new Google row.
    // Skip if already on a real account (idempotent: covers re-link flows).
    const current = cloudUserRef.current;
    if (current?.is_anonymous) {
      try {
        localStorage.setItem(PENDING_ANON_MIGRATE_KEY, current.id);
      } catch {
        /* storage disabled — migration won't run, but sign-in still works */
      }
    }
    const redirectTo = `${window.location.origin}/auth/callback`;
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo },
      });
      if (error) {
        setOauthError('تعذّر بدء تسجيل الدخول. تحقّق من الاتصال وحاول مجددًا.');
      }
    } catch {
      // Network failure / popup blocker / browser quirk — surface inline so
      // the user knows the click did something. Without this the Google
      // button just sits there looking unclicked.
      setOauthError('تعذّر بدء تسجيل الدخول. تحقّق من الاتصال وحاول مجددًا.');
    }
  }, []);

  // Wait for in-flight saves to commit, but cap at 3s so a hung fetch on
  // bad network can't freeze sign-out / delete forever. Worst case a row
  // gets orphaned — already an accepted failure mode for the fire-and-forget
  // save path. Returns when drain completes or the timer expires, whichever
  // comes first.
  const drainPendingSaves = useCallback(async () => {
    if (pendingSaves.current.size === 0) return;
    await Promise.race([
      Promise.allSettled(Array.from(pendingSaves.current)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }, []);

  const handleSignOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    setSignOutPending(true);
    destructiveActive.current = true;
    try {
      // Drain pending saves first so rows commit under the outgoing user_id.
      await drainPendingSaves();
      await supabase.auth.signOut();
      // Bootstrap a fresh anonymous session so the app stays usable.
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        // Anon sign-in failed — strip cloud state so we don't post-401 saves
        // into the void. The user can refresh to retry.
        console.warn('[cloud] anonymous re-sign-in failed after sign-out:', error.message);
        setCloudUser(null);
        setCloudReady(false);
      } else {
        setCloudUser(data.user ?? null);
      }
    } catch (err) {
      // signOut() can throw on network failure. Don't strand the user with
      // stale cloud state — clear local UI either way; refresh recovers.
      console.warn('[cloud] sign-out failed:', err instanceof Error ? err.message : err);
    } finally {
      // Always reset visible products + close modal even if sign-out partially
      // failed. Leaving the previous user's listings on screen under the new
      // (anonymous or cleared) session is dishonest UX.
      setProducts([newProduct(1)]);
      setSyncOpen(false);
      setSignOutPending(false);
      destructiveActive.current = false;
    }
  }, [drainPendingSaves]);

  // Open the confirm modal. The actual destructive call is in
  // handleConfirmDeleteAll. Splitting the two means the modal can keep
  // rendering "جارٍ الحذف…" while the network call is in flight.
  const handleDeleteAll = useCallback(() => {
    // Clear any stale error from a previous failed attempt before reopening.
    setDeleteError(null);
    setConfirmDeleteOpen(true);
  }, []);

  const handleConfirmDeleteAll = useCallback(async () => {
    setDeletePending(true);
    setDeleteError(null);
    destructiveActive.current = true;
    let deleteSucceeded = false;
    try {
      // Drain pending saves so a save that lands AFTER the DELETE doesn't
      // immediately re-create an orphan row under the about-to-be-replaced
      // anonymous user_id.
      await drainPendingSaves();
      let res: Response | null = null;
      try {
        res = await fetch('/api/listings', { method: 'DELETE' });
      } catch {
        // Network failure — surface in the modal, don't reset local state
        // (the cloud rows still exist; lying to the user is worse than
        // showing the error).
        setDeleteError('فشل الاتصال. تحقّق من الشبكة وحاول مجددًا.');
        return;
      }
      if (!res.ok) {
        // Server responded but failed — same logic as network failure: keep
        // the modal open, don't pretend the wipe happened.
        setDeleteError('تعذّر حذف بياناتك. حاول مجددًا، فإذا استمرّت المشكلة أعد تحميل الصفحة.');
        return;
      }
      deleteSucceeded = true;
      // Re-sign-in anonymously so the session continues to work. (The DELETE
      // route also called signOut server-side; the client cookie is now
      // stale so the next session bootstrap MUST mint a fresh anon user.)
      const supabase = getSupabase();
      if (supabase) {
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) {
          console.warn('[cloud] anonymous re-sign-in failed after delete:', error.message);
          setCloudUser(null);
          setCloudReady(false);
        } else {
          setCloudUser(data.user ?? null);
        }
      }
    } finally {
      if (deleteSucceeded) {
        // Reset local UI only on confirmed success.
        setProducts([newProduct(1)]);
        setSyncOpen(false);
        setConfirmDeleteOpen(false);
        setCloudActionToast('تم حذف بياناتك السحابية.');
      }
      // Always clear pending — even on failure the user needs an enabled
      // dialog to read the error and either retry or cancel.
      setDeletePending(false);
      destructiveActive.current = false;
    }
  }, [drainPendingSaves]);

  const generateAll = async () => {
    // Snapshot the eligible IDs once so we don't react to setState changes
    // mid-iteration. allSettled keeps one failure from aborting the rest.
    const ids = products.filter((p) => !p.loading && !p.result).map((p) => p.id);
    await Promise.allSettled(ids.map((id) => generate(id)));
  };

  const completedCount = products.filter((p) => !!p.result).length;

  const exportCsv = () => {
    const rows: ProductRow[] = products
      .filter((p): p is ProductState & { result: Listing } => p.result !== null)
      .map((p) => ({
        name: p.name,
        urls: parseUrls(p.text),
        listing: p.result,
      }));
    if (rows.length === 0) return;
    const csv = productsToCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`noon-listings-${stamp}.csv`, csv);
  };

  const byokLabel = byok
    ? PROVIDER_OPTIONS.find((p) => p.id === byok.provider)?.label ?? byok.provider
    : null;

  return (
    <div className="min-h-screen">
      {/* Aria-live toast for post-action confirmation. Fixed-position pill,
          fades + slides in via motion. aria-live="polite" so screen readers
          announce without hijacking focus. RTL-aware via inset-x centering. */}
      <AnimatePresence>
        {cloudActionToast && (
          <motion.div
            key="cloud-toast"
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            className="fixed inset-x-0 top-4 z-[70] flex justify-center px-4 pointer-events-none"
          >
            <div className="flex items-center gap-2 rounded-full border border-emerald-300/70 bg-emerald-50/95 px-4 py-2 text-sm font-medium text-emerald-800 shadow-lg backdrop-blur dark:border-emerald-700/60 dark:bg-emerald-950/70 dark:text-emerald-200">
              <Check className="h-4 w-4" />
              {cloudActionToast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header — sticky, glassy, with branded logo glow. The logo's pulse is
          a subtle "alive" cue (motion budget: medium per the design brief). */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--border-soft)] bg-[color-mix(in_oklab,var(--surface)_80%,transparent)] backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <motion.div
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
            className="flex items-center gap-3"
          >
            <motion.div
              whileHover={{ rotate: -6, scale: 1.06 }}
              whileTap={{ scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 400, damping: 18 }}
              className="relative flex h-10 w-10 items-center justify-center rounded-2xl text-noon-ink shadow-[0_8px_24px_-8px_rgba(254,238,0,0.5)]"
              style={{
                background:
                  'linear-gradient(135deg, var(--noon-yellow) 0%, var(--noon-yellow-600) 100%)',
              }}
            >
              <Zap className="h-5 w-5" strokeWidth={2.5} />
              <span
                aria-hidden="true"
                className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/40"
              />
            </motion.div>
            <div className="leading-tight">
              <h1 className="text-base font-semibold tracking-tight">مولد أوصاف منتجات نون</h1>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 ltr">by The360Squad</p>
            </div>
          </motion.div>
          <div className="flex items-center gap-2">
            {byokLabel && (
              <motion.span
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25 }}
                className="hidden items-center gap-1.5 rounded-full border border-emerald-300/60 bg-emerald-50/80 px-3 py-1 text-xs font-medium text-emerald-800 backdrop-blur dark:border-emerald-700/60 dark:bg-emerald-950/40 dark:text-emerald-300 sm:inline-flex"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]" />
                {byokLabel}
              </motion.span>
            )}
            {/* Cloud sync — always visible once the backend is wired so users
                can find sign-in BEFORE their first generation. Pulses softly
                while anonymous to nudge sign-in (motion-safe via reduced-motion
                CSS). */}
            {cloudReady && (
              <motion.button
                type="button"
                onClick={() => setSyncOpen(true)}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.96 }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-stronger)] bg-[color:var(--surface)] px-2.5 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-[color:var(--surface-elev)]"
                title={
                  cloudUser && !cloudUser.is_anonymous
                    ? 'مزامن عبر الأجهزة'
                    : 'احفظ بياناتك عبر الأجهزة'
                }
                aria-label="حفظ ومزامنة"
              >
                {cloudUser && !cloudUser.is_anonymous ? (
                  <Cloud className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <CloudOff className="h-3.5 w-3.5" />
                )}
              </motion.button>
            )}
            <motion.button
              type="button"
              onClick={() => setByokOpen(true)}
              whileTap={{ scale: 0.96 }}
              className={
                byok
                  ? 'inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-stronger)] bg-[color:var(--surface)] px-3 py-1.5 text-xs font-medium shadow-sm transition-colors hover:bg-[color:var(--surface-elev)]'
                  : 'btn-noon inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold'
              }
            >
              {byok ? <KeyRound className="h-3.5 w-3.5" /> : <Settings className="h-3.5 w-3.5" />}
              {byok ? 'مفتاحك' : 'ابدأ الإعداد'}
            </motion.button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Intro */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
          className="mb-7 card-surface rounded-2xl p-5 sm:p-6"
        >
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-noon-yellow shadow-[0_0_0_3px_rgba(254,238,0,0.25)]" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500 ltr">
              Bilingual · Noon-ready
            </span>
          </div>
          <h2 className="mb-2 text-xl font-semibold tracking-tight sm:text-[22px]">
            أنشئ قوائم جاهزة لنون — بضغطة واحدة
          </h2>
          <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-[15px]">
            الصق روابط المنتج من أي متجر (AliExpress، Amazon، Shopify، Salla، أو أي مصدر) أو ألصق صور المنتج.
            ستحصل على عنوان ووصف و5 ميزات متوافقة مع نون — بالعربية والإنجليزية. أضف منتجات أخرى ثم صدّر الكل كملف CSV واحد.
          </p>
        </motion.section>

        {/* Onboarding — shown until the user configures a BYOK key. Three-step
             flow: (1) click "Get free Gemini key" → opens aistudio in new tab,
             (2) copy key from there, (3) come back and paste into the inline
             input right here. Auto-detects provider from key prefix. */}
        <AnimatePresence>
          {!byok && (
            <motion.section
              key="onboarding"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.2 } }}
              transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1], delay: 0.05 }}
              className="relative mb-7 overflow-hidden rounded-2xl border border-noon-yellow/40 p-5 shadow-[0_8px_32px_-12px_rgba(254,238,0,0.35)] sm:p-7"
              style={{
                background:
                  'linear-gradient(135deg, color-mix(in oklab, var(--noon-yellow) 18%, var(--surface)) 0%, var(--surface) 60%, var(--surface-elev) 100%)',
              }}
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full"
                style={{
                  background:
                    'radial-gradient(circle, color-mix(in oklab, var(--noon-yellow) 35%, transparent) 0%, transparent 70%)',
                }}
              />
              <div className="relative">
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-noon-yellow/50 bg-noon-yellow/15 px-3 py-1">
                  <Sparkles className="h-3.5 w-3.5 text-noon-ink dark:text-noon-yellow" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-noon-ink dark:text-noon-yellow">
                    ابدأ خلال 30 ثانية
                  </span>
                </div>
                <h2 className="mb-1.5 text-xl font-semibold tracking-tight sm:text-2xl">
                  أحضر مفتاح API خاصًا بك للبدء
                </h2>
                <p className="mb-5 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 sm:text-[15px]">
                  هذه الأداة تستخدم مفتاحك الخاص — لا حساب مطلوب، ولا رسوم من جانبنا.
                  يُحفظ المفتاح في متصفحك فقط، ويُمرَّر إلى المزود مباشرة لكل عملية.
                  الخيار الأسرع: احصل على{' '}
                  <strong>مفتاح Gemini مجاني من Google</strong> ثم ألصقه أدناه.
                </p>

                {/* Step 1: open AIStudio */}
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <motion.a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noreferrer"
                    whileHover={{ y: -1 }}
                    whileTap={{ scale: 0.96 }}
                    className="btn-noon inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                  >
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-noon-ink/10 text-[10px] font-bold">
                      1
                    </span>
                    احصل على مفتاح Gemini مجاني
                    <ArrowUpRight className="h-4 w-4" />
                  </motion.a>
                  <span className="text-xs text-zinc-500">
                    يفتح في تبويب جديد — انسخ المفتاح الذي يبدأ بـ <code className="ltr font-mono text-[11px]">AIza...</code>
                  </span>
                </div>

                {/* Step 2: paste inline */}
                <QuickKeyInput onSaved={persistByok} onOpenFull={() => setByokOpen(true)} />

                <div className="mt-4 text-xs text-zinc-500 ltr">
                  Also supported: Anthropic · OpenAI · Groq · Mistral · OpenRouter —
                  <button
                    type="button"
                    onClick={() => setByokOpen(true)}
                    className="ml-1 font-medium underline decoration-dotted underline-offset-4 hover:text-zinc-700 dark:hover:text-zinc-300"
                  >
                    pick provider manually
                  </button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Product cards — staggered enter, hover lift, layout-animated for
            smooth add/remove. The inner sections keep the existing layout
            so all the audit-fix behavior (fromCloud badge, error/success
            text, regen logic) renders unchanged. */}
        <div className="space-y-4">
          <AnimatePresence initial={false}>
            {products.map((p, idx) => (
              <motion.article
                key={p.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.97, transition: { duration: 0.18 } }}
                transition={{
                  duration: 0.32,
                  ease: [0.32, 0.72, 0, 1],
                  delay: Math.min(idx * 0.04, 0.16),
                }}
                whileHover={{ y: -2 }}
                className="card-surface overflow-hidden rounded-2xl"
              >
                <header className="flex items-center justify-between gap-3 border-b border-[color:var(--border-soft)] px-4 py-3 sm:px-5">
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updateProduct(p.id, { name: e.target.value })}
                    className="flex-1 bg-transparent text-sm font-semibold tracking-tight outline-none"
                    aria-label="اسم المنتج"
                  />
                  {p.fromCloud && p.images.length === 0 && (
                    <motion.span
                      initial={{ opacity: 0, scale: 0.92 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="rounded-full border border-amber-300/60 bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-800 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200"
                    >
                      مُستعادة — أضف صورًا قبل إعادة الإنشاء
                    </motion.span>
                  )}
                  {products.length > 1 && (
                    <motion.button
                      type="button"
                      onClick={() => removeProduct(p.id)}
                      whileTap={{ scale: 0.92 }}
                      className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"
                      aria-label={`حذف المنتج ${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </motion.button>
                  )}
                </header>

                <div className="space-y-4 p-4 sm:p-5">
                  <div>
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
                    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                      ملاحظة (اختياري)
                    </label>
                    <textarea
                      value={p.note}
                      onChange={(e) => updateProduct(p.id, { note: e.target.value })}
                      rows={2}
                      placeholder="مثال: السوق المستهدف السعودية، نساء 25-40، سعر حوالي 89 ريال"
                      className="block w-full resize-y rounded-lg border border-[color:var(--border-stronger)] bg-[color:var(--surface)] p-2.5 text-xs transition-colors focus:border-noon-yellow-600 focus:outline-none focus:ring-2 focus:ring-noon-yellow/40"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 border-t border-[color:var(--border-soft)] bg-[color:var(--surface-elev)] px-4 py-3 sm:px-5">
                  <div className="min-w-0 flex-1 text-xs">
                    <AnimatePresence mode="wait">
                      {p.error ? (
                        <motion.span
                          key="err"
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          className="font-medium text-red-600"
                        >
                          {p.error}
                        </motion.span>
                      ) : p.result ? (
                        <motion.span
                          key="ok"
                          initial={{ opacity: 0, scale: 0.92 }}
                          animate={{ opacity: 1, scale: 1 }}
                          className="inline-flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400"
                        >
                          <Check className="h-3.5 w-3.5" />
                          تم الإنشاء
                        </motion.span>
                      ) : (
                        <motion.span
                          key="idle"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-zinc-500"
                        >
                          {p.loading ? 'جارٍ الإنشاء…' : 'جاهز للإنشاء'}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <motion.button
                    type="button"
                    onClick={() => generate(p.id)}
                    disabled={p.loading || !byok}
                    whileTap={{ scale: p.loading || !byok ? 1 : 0.96 }}
                    title={!byok ? 'أضف مفتاح API في الإعدادات أولًا' : undefined}
                    className={
                      p.result
                        ? 'inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-stronger)] bg-[color:var(--surface)] px-3.5 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-[color:var(--surface-elev)] disabled:opacity-60'
                        : 'btn-noon inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold disabled:opacity-60'
                    }
                  >
                    {p.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : p.result ? (
                      'إعادة الإنشاء'
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        أنشئ
                      </>
                    )}
                  </motion.button>
                </div>

                {/* Result panel — Arabic first (primary audience), English second */}
                <AnimatePresence>
                  {p.result && (
                    <motion.div
                      key="result"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                      className="overflow-hidden border-t border-[color:var(--border-soft)]"
                    >
                      <div className="space-y-3 p-4 sm:p-5">
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
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.article>
            ))}
          </AnimatePresence>
        </div>

        {/* Footer actions */}
        <div className="mt-7 flex flex-wrap items-center gap-2">
          <motion.button
            type="button"
            onClick={addProduct}
            whileTap={{ scale: 0.96 }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[color:var(--border-stronger)] bg-[color:var(--surface)] px-3.5 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-[color:var(--surface-elev)]"
          >
            <Plus className="h-4 w-4" />
            أضف منتجًا آخر
          </motion.button>

          <motion.button
            type="button"
            onClick={generateAll}
            disabled={!byok || products.every((p) => p.loading || !!p.result)}
            whileTap={{ scale: 0.96 }}
            title={!byok ? 'أضف مفتاح API في الإعدادات أولًا' : undefined}
            className="btn-noon inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            أنشئ الكل
          </motion.button>

          <div className="flex-1" />

          <motion.button
            type="button"
            onClick={exportCsv}
            disabled={completedCount === 0}
            whileTap={{ scale: completedCount === 0 ? 1 : 0.96 }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-all hover:bg-emerald-500 hover:shadow-emerald-500/30 hover:shadow-md disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            تصدير {completedCount > 0 ? `${completedCount} ` : ''}إلى CSV
          </motion.button>
        </div>

        <AnimatePresence>
          {cloudReady && cloudUser?.is_anonymous && completedCount >= 1 && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mt-3 text-xs text-zinc-500 dark:text-zinc-500"
            >
              بياناتك محفوظة محليًا فقط — اضغط{' '}
              <Cloud className="inline h-3 w-3 align-[-1px]" /> للمزامنة عبر الأجهزة.
            </motion.p>
          )}
        </AnimatePresence>

        <footer className="mt-12 border-t border-[color:var(--border-soft)] pt-6 text-center text-xs leading-relaxed text-zinc-500">
          يلتزم بقواعد نون: لا رموز تعبيرية في الأوصاف أو النقاط، عناوين 20–200 حرف، 5 ميزات بحد أقصى 250 حرفًا.
          <br />
          <span className="ltr font-medium">Bring-your-own-key · by The360Squad</span>
        </footer>
      </main>

      <AnimatePresence>
        {byokOpen && (
          <ByokModal initial={byok} onSave={persistByok} onClose={() => setByokOpen(false)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {syncOpen && (
          <SyncModal
            user={cloudUser}
            onClose={() => {
              setSyncOpen(false);
              setOauthError(null);
            }}
            onSignIn={handleGoogleSignIn}
            onSignOut={handleSignOut}
            onDeleteAll={handleDeleteAll}
            signOutPending={signOutPending}
            oauthError={oauthError}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmDeleteOpen && (
          <ConfirmDeleteAllModal
            onConfirm={handleConfirmDeleteAll}
            onCancel={() => {
              // Don't allow dismiss while the destructive call is mid-flight —
              // closing here would leave deletePending stuck true on next open.
              if (!deletePending) {
                setConfirmDeleteOpen(false);
                setDeleteError(null);
              }
            }}
            pending={deletePending}
            error={deleteError}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
