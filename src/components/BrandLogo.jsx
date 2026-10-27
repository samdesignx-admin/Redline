import React from "react";

// One scalable symbol shared with /favicon.svg and /uxnest-mark.svg.
// The mark is drawn as crisp vector paths instead of using a padded bitmap
// that becomes nearly invisible in the mobile header.
export default function BrandLogo({
  size = 28,
  showWordmark = true,
  dark = false,
  className = "",
}) {
  const dimension = Math.max(16, Number(size) || 28);
  const wordSize = Math.round(dimension * 0.90);
  const spacing = Math.max(7, Math.round(dimension * 0.24));

  return (
    <span
      className={className}
      role="img"
      aria-label="UXNest"
      style={{
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        whiteSpace: "nowrap",
        gap: showWordmark ? spacing : 0,
        minHeight: dimension,
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      <svg
        width={dimension}
        height={dimension}
        viewBox="0 0 64 64"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={{ display: "block", flexShrink: 0 }}
      >
        <rect width="64" height="64" rx="16" fill="#0B8B78" />
        <path
          d="M18 17v16c0 9 6 15 14 15s14-6 14-15V17"
          stroke="#FFFFFF"
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M27 24v9c0 3 2 5 5 5s5-2 5-5v-9"
          stroke="#9AF1D8"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showWordmark && (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
            fontSize: wordSize,
            fontWeight: 850,
            letterSpacing: "-0.052em",
            lineHeight: 1,
            display: "inline-block",
          }}
        >
          <span style={{ color: dark ? "#FFFFFF" : "#18211F" }}>UX</span>
          <span style={{ color: dark ? "#9AF1D8" : "#0B8B78" }}>Nest</span>
        </span>
      )}
    </span>
  );
}
