import { z } from 'zod';

// Noon's published constraints. Enforcing these in the schema so the model
// self-corrects if it drifts, AND so we can't ship a listing that'll get
// QC-rejected.

const LISTING_LANG = z.object({
  title: z
    .string()
    .min(20, 'Title must be at least 20 characters')
    .max(200, 'Title must be 200 characters or fewer'),
  description: z
    .string()
    .min(250, 'Description must be at least 250 characters')
    .max(4000, 'Description must be 4000 characters or fewer'),
  features: z
    .array(
      z
        .string()
        // 30 min matches the prompt rules in src/lib/prompt.ts and Noon's QC.
        .min(30, 'Each bullet should be at least 30 characters')
        .max(250, 'Each bullet must be 250 characters or fewer'),
    )
    .length(5, 'Exactly 5 feature bullets are required'),
});

export const ListingSchema = z.object({
  en: LISTING_LANG,
  ar: LISTING_LANG,
});

export type Listing = z.infer<typeof ListingSchema>;

export const GenerateRequestSchema = z.object({
  urls: z.array(z.string().url()).max(10).optional().default([]),
  images: z
    .array(
      // Restrict to raster mime-types (no SVG — its XML payload is an XSS
      // vector if we ever render it). Cap each data-URI at ~8 MB to defend
      // against bypassing the client-side resize and OOMing the function.
      z
        .string()
        .regex(
          /^data:image\/(jpeg|png|webp);base64,/,
          'Only JPEG / PNG / WebP base64 data URIs are allowed',
        )
        .max(8_000_000, 'Each image must be smaller than ~8 MB'),
    )
    .max(10, 'Up to 10 images per product')
    .optional()
    .default([]),
  note: z.string().max(2000).optional(),
});

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
