import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { ListingSchema, GenerateRequestSchema } from '@/lib/schema';
import { NOON_SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';
import { resolveModel, isByokProvider } from '@/lib/providers';
import { checkQuota, FREE_QUOTA, currentUsage } from '@/lib/ratelimit';

// Fluid Compute (default) — full Node.js runtime. 60s is plenty for Haiku.
export const runtime = 'nodejs';
export const maxDuration = 60;

function getClientIp(req: NextRequest): string {
  // Vercel sets x-forwarded-for. Behind Cloudflare we'd want CF-Connecting-IP;
  // since we're on vercel.app this is the right header.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  const real = req.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

function validProvider(raw: string | null) {
  if (!raw) return undefined;
  return isByokProvider(raw) ? raw : undefined;
}

export async function GET(req: NextRequest) {
  // Lightweight status endpoint so the UI can show the user their quota on load.
  const ip = getClientIp(req);
  const { used, remaining, backend } = await currentUsage(ip);
  return NextResponse.json({
    quota: { free: FREE_QUOTA, used, remaining },
    backend,
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);

  // Parse BYOK headers first — a valid BYOK bypasses the free quota entirely.
  const byokProvider = validProvider(req.headers.get('x-byok-provider'));
  const byokKey = req.headers.get('x-byok-key') || undefined;
  const byokModel = req.headers.get('x-byok-model')?.trim() || undefined;
  const usingByok = !!(byokProvider && byokKey && byokKey.length > 10);

  if (!usingByok) {
    const quota = await checkQuota(ip, false);
    if (!quota.allowed) {
      return NextResponse.json(
        {
          error: quota.reason === 'burst' ? 'burst_limit' : 'quota_exhausted',
          message:
            quota.reason === 'burst'
              ? 'Too many requests in a short window. Wait a minute and try again.'
              : `You've used all ${FREE_QUOTA} free generations. Add your own API key in Settings to continue — free and unlimited with your key.`,
          used: quota.used,
          remaining: 0,
        },
        { status: 429 },
      );
    }
  }

  // Body parse + validation.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'bad_json', message: 'Request body must be valid JSON.' },
      { status: 400 },
    );
  }
  const parsed = GenerateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'invalid_input',
        message: 'Input failed validation.',
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }
  const { urls, images, note } = parsed.data;
  if (urls.length === 0 && images.length === 0) {
    return NextResponse.json(
      {
        error: 'empty_input',
        message: 'Provide at least one URL or one image.',
      },
      { status: 400 },
    );
  }

  // Consume one quota credit ONLY when not on BYOK. Do this BEFORE the model
  // call so a failed generation still costs a credit — this prevents someone
  // from intentionally breaking inputs to fish for free generations. If that
  // feels wrong, we can swap the order later, but then we need replay protection.
  let quotaState: { used: number; remaining: number } | null = null;
  if (!usingByok) {
    const consumed = await checkQuota(ip, true);
    quotaState = { used: consumed.used, remaining: consumed.remaining };
  }

  const { model, label } = resolveModel({ provider: byokProvider, key: byokKey, model: byokModel });

  try {
    const result = await generateObject({
      model,
      schema: ListingSchema,
      system: NOON_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: buildUserPrompt({ urls, imageCount: images.length, noteFromUser: note }) },
            ...images.map((img) => ({ type: 'image' as const, image: img })),
          ],
        },
      ],
      // Haiku is fast — keep the retry low so failure surfaces quickly.
      maxRetries: 1,
    });

    return NextResponse.json({
      listing: result.object,
      meta: {
        model: label,
        byok: usingByok,
        quota: usingByok ? null : quotaState,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown generation error.';
    // Common failure: BYOK key is invalid. Surface it clearly.
    const hint = usingByok && /401|unauthori[sz]ed|api.?key/i.test(msg)
      ? 'Your API key was rejected by the provider. Double-check it in Settings.'
      : 'The model failed to generate a valid listing. Try again, or simplify the input.';
    return NextResponse.json(
      {
        error: 'generation_failed',
        message: hint,
        detail: msg.slice(0, 400),
      },
      { status: 502 },
    );
  }
}
