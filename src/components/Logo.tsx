import React, { useId } from 'react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  heartOnly?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ className = 'h-10 w-auto', showText = true, heartOnly = false }) => {
  const rawId = useId();
  const uniqueId = rawId.replace(/:/g, '');
  const gradId = `silverGrad_4k_${uniqueId}`;
  const renderText = showText && !heartOnly;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={heartOnly ? "350 110 500 460" : "0 100 1200 660"}
      className={className}
      shapeRendering="geometricPrecision"
      textRendering="geometricPrecision"
      style={{
        background: 'transparent',
      }}
    >
      <defs>
        {/* 4K Ultra High-Definition Metallic Silver Gradient */}
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="25%" stopColor="#F3F4F6" />
          <stop offset="50%" stopColor="#D1D5DB" />
          <stop offset="75%" stopColor="#9CA3AF" />
          <stop offset="100%" stopColor="#FFFFFF" />
        </linearGradient>
      </defs>

      <g>
        {/* הלב - 4K High Precision Vector Path */}
        <path
          d="M600 540 C600 540, 380 400, 380 260 C380 180, 448 140, 512 140 C560 140, 588 168, 600 192 C612 168, 640 140, 688 140 C752 140, 820 180, 820 260 C820 400, 600 540, 600 540 Z"
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth="26"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* תו מוזיקלי במרכז - 4K Vector Path */}
        <path
          d="M624 168 L624 368 C624 404, 592 428, 556 428 C524 428, 504 408, 504 380 C504 352, 528 328, 564 328 C580 328, 592 332, 600 340 L600 140 C600 140, 656 168, 688 208 C704 228, 704 256, 696 272 C688 248, 660 212, 624 196 Z"
          fill={`url(#${gradId})`}
        />
      </g>

      {/* טקסט המותג - 4K Crisp Typography */}
      {renderText && (
        <text
          x="600"
          y="710"
          textAnchor="middle"
          fill={`url(#${gradId})`}
          fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
          fontSize="90"
          fontWeight="800"
          letterSpacing="16"
        >
          KOLOT MUSIC
        </text>
      )}
    </svg>
  );
};
