import type { SelectionArrangement } from './arrangeSelection';

interface SelectionArrangementIconProps {
  operation: SelectionArrangement;
  size?: number;
  className?: string;
}

/**
 * Compact diagram-tool icons for the multi-selection arrange menu. The thin
 * rule is the alignment edge/axis; the heavier strokes represent tables.
 */
export function SelectionArrangementIcon({
  operation,
  size = 22,
  className,
}: SelectionArrangementIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
      data-arrangement-icon={operation}
    >
      {arrangementGlyph(operation)}
    </svg>
  );
}

function arrangementGlyph(operation: SelectionArrangement) {
  const itemProps = {
    stroke: 'currentColor',
    strokeWidth: 2.5,
    strokeLinecap: 'round' as const,
  };
  const guideProps = {
    stroke: 'currentColor',
    strokeWidth: 1.25,
    strokeLinecap: 'round' as const,
    opacity: 0.5,
  };

  switch (operation) {
    case 'align-left':
      return (
        <>
          <path d="M4 3v18" {...guideProps} />
          <path d="M7 6h9M7 12h13M7 18h7" {...itemProps} />
        </>
      );
    case 'align-horizontal-center':
      return (
        <>
          <path d="M12 3v18" {...guideProps} />
          <path d="M7 6h10M4 12h16M8 18h8" {...itemProps} />
        </>
      );
    case 'align-right':
      return (
        <>
          <path d="M20 3v18" {...guideProps} />
          <path d="M8 6h9M4 12h13M10 18h7" {...itemProps} />
        </>
      );
    case 'align-top':
      return (
        <>
          <path d="M3 4h18" {...guideProps} />
          <path d="M6 7v9M12 7v13M18 7v7" {...itemProps} />
        </>
      );
    case 'align-vertical-center':
      return (
        <>
          <path d="M3 12h18" {...guideProps} />
          <path d="M6 7v10M12 4v16M18 8v8" {...itemProps} />
        </>
      );
    case 'align-bottom':
      return (
        <>
          <path d="M3 20h18" {...guideProps} />
          <path d="M6 8v9M12 4v13M18 10v7" {...itemProps} />
        </>
      );
    case 'distribute-horizontal':
      return (
        <>
          <path d="M3 3h18M3 21h18" {...guideProps} />
          <rect x="3" y="7" width="4" height="10" rx="1" stroke="currentColor" strokeWidth="2" />
          <rect x="10" y="5" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="2" />
          <rect x="17" y="8" width="4" height="8" rx="1" stroke="currentColor" strokeWidth="2" />
        </>
      );
    case 'distribute-vertical':
      return (
        <>
          <path d="M3 3v18M21 3v18" {...guideProps} />
          <rect x="7" y="3" width="10" height="4" rx="1" stroke="currentColor" strokeWidth="2" />
          <rect x="5" y="10" width="14" height="4" rx="1" stroke="currentColor" strokeWidth="2" />
          <rect x="8" y="17" width="8" height="4" rx="1" stroke="currentColor" strokeWidth="2" />
        </>
      );
  }
}
