import React from 'react';

interface LogoProps {
  compact?: boolean;
  showArabic?: boolean;
}

export const Logo: React.FC<LogoProps> = ({ compact = false, showArabic = false }) => {
  return (
    <div className="inline-flex items-center gap-2.5 whitespace-nowrap shrink-0 select-none">
      <svg
        width={compact ? 24 : 28}
        height={compact ? 24 : 28}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M16 3L29 27H23.2L16 13.4L8.8 27H3L16 3Z"
          fill="#000000"
        />
        <path
          d="M16 17.5L21.2 27H10.8L16 17.5Z"
          fill="#059669"
        />
        <path
          d="M9.5 21.5H22.5"
          stroke="#FFFFFF"
          strokeWidth="1.7"
          strokeLinecap="square"
        />
      </svg>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[15px] sm:text-base font-bold tracking-tight text-black whitespace-nowrap">
          Apex Confluence
        </span>
        {showArabic && (
          <span className="hidden sm:inline text-xs font-medium text-neutral-500 whitespace-nowrap">
            أبيكس كونفلوينس
          </span>
        )}
      </div>
    </div>
  );
};
