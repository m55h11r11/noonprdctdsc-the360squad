import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };
export const alt = 'Noon Product Description Generator — The360Squad';

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px',
          background: 'linear-gradient(135deg, #18181B 0%, #27272A 100%)',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: 18,
              background: '#FEE133',
              color: '#111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 56,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            N
          </div>
          <div style={{ fontSize: 28, opacity: 0.7 }}>The360Squad</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Noon Product</span>
            <span>Description Generator</span>
          </div>
          <div style={{ fontSize: 32, opacity: 0.8, maxWidth: 900, lineHeight: 1.3 }}>
            AliExpress URLs, Noon-compliant listings in English and Arabic. Multi-product, CSV
            export, bring-your-own-key.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 16, fontSize: 22, opacity: 0.7 }}>
          <span
            style={{
              padding: '8px 16px',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
            }}
          >
            Claude Haiku 4.5
          </span>
          <span
            style={{
              padding: '8px 16px',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
            }}
          >
            10 free generations
          </span>
          <span
            style={{
              padding: '8px 16px',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 999,
            }}
          >
            Noon-QC compliant
          </span>
        </div>
      </div>
    ),
    { ...size },
  );
}
