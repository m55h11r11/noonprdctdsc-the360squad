import type { Listing } from './schema';

// Noon seller center bulk upload accepts English + Arabic columns per-SKU.
// This CSV is a neutral intermediate — user can re-arrange columns to match
// their specific category template in the Noon bulk uploader.

export interface ProductRow {
  name: string;
  urls: string[];
  listing: Listing;
}

const COLUMNS = [
  'Product Name',
  'Source URLs',
  'EN Title',
  'EN Description',
  'EN Feature 1',
  'EN Feature 2',
  'EN Feature 3',
  'EN Feature 4',
  'EN Feature 5',
  'AR Title',
  'AR Description',
  'AR Feature 1',
  'AR Feature 2',
  'AR Feature 3',
  'AR Feature 4',
  'AR Feature 5',
] as const;

function escapeCell(value: string): string {
  // RFC 4180: quote cells that contain comma, quote, or newline; double the quotes inside.
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function productsToCsv(products: ProductRow[]): string {
  const lines: string[] = [];
  lines.push(COLUMNS.map(escapeCell).join(','));
  for (const p of products) {
    const row = [
      p.name,
      p.urls.join(' | '),
      p.listing.en.title,
      p.listing.en.description,
      ...p.listing.en.features,
      p.listing.ar.title,
      p.listing.ar.description,
      ...p.listing.ar.features,
    ];
    // Pad to column count defensively (features array length is enforced by Zod at 5,
    // but if we ever relax that we don't want ragged rows).
    while (row.length < COLUMNS.length) row.push('');
    lines.push(row.slice(0, COLUMNS.length).map(escapeCell).join(','));
  }
  // BOM lets Excel open UTF-8 Arabic content without mojibake.
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
