import { NextRequest, NextResponse } from 'next/server';
import { generateObject } from 'ai';
import { ListingSchema, GenerateRequestSchema } from '@/lib/schema';
import { NOON_SYSTEM_PROMPT, buildUserPrompt } from '@/lib/prompt';
import { resolveModel, isByokProvider } from '@/lib/providers';

// Fluid Compute (default) — full Node.js runtime. 60s is plenty for Haiku.
export const runtime = 'nodejs';
export const maxDuration = 60;

function validProvider(raw: string | null) {
  if (!raw) return undefined;
  return isByokProvider(raw) ? raw : undefined;
}

export async function GET() {
  // Status endpoint — kept so the client can detect the BYOK-only mode on load.
  // Intentionally simple: no counters, no backend state, nothing that could
  // surprise the owner with a bill.
  return NextResponse.json({ mode: 'byok-only' });
}

export async function POST(req: NextRequest) {
  // Parse BYOK headers. A valid BYOK is now REQUIRED — the app is
  // bring-your-own-key only, so the owner never pays for end-user generations.
  const byokProvider = validProvider(req.headers.get('x-byok-provider'));
  const byokKey = req.headers.get('x-byok-key') || undefined;
  const byokModel = req.headers.get('x-byok-model')?.trim() || undefined;

  if (!byokProvider || !byokKey || byokKey.length < 10) {
    return NextResponse.json(
      {
        error: 'byok_required',
        message:
          'Add your own API key in Settings to generate. Free Gemini keys take 30 seconds at aistudio.google.com.',
      },
      { status: 403 },
    );
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
      { error: 'empty_input', message: 'Provide at least one URL or one image.' },
      { status: 400 },
    );
  }

  const { model, label } = resolveModel({
    provider: byokProvider,
    key: byokKey,
    model: byokModel,
  });

  try {
    const result = await generateObject({
      model,
      schema: ListingSchema,
      system: NOON_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: buildUserPrompt({
                urls,
                imageCount: images.length,
                noteFromUser: note,
              }),
            },
            ...images.map((img) => ({ type: 'image' as const, image: img })),
          ],
        },
      ],
      // Haiku is fast — keep retry low so failure surfaces quickly.
      maxRetries: 1,
    });

    return NextResponse.json({
      listing: result.object,
      meta: { model: label },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown generation error.';
    // Common failure: the user's BYOK key is invalid. Surface it clearly so
    // they open Settings and fix it, not us.
    const looksLikeAuth = /401|403|unauthori[sz]ed|api.?key|invalid.?key/i.test(msg);
    const hint = looksLikeAuth
      ? 'Your API key was rejected by the provider. Check it in Settings.'
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
