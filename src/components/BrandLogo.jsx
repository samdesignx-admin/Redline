import React from "react";

// Displays the user-approved UXNest green-to-teal U/leaf artwork.
// Icon and wordmark are tightly cropped from the approved source, so neither
// shrinks into empty padding in the mobile header or presentation deck.
export default function BrandLogo({
  size = 28,
  showWordmark = true,
  dark = false,
  className = "",
}) {
  const [iconFailed, setIconFailed] = React.useState(false);
  const [wordmarkFailed, setWordmarkFailed] = React.useState(false);
  const dimension = Math.max(16, Number(size) || 28);
  const textHeight = Math.round(dimension * 0.83);
  const gap = Math.max(6, Math.round(dimension * 0.21));
  const wordColor = dark ? "#FFFFFF" : "#08172B";
  const nestColor = dark ? "#8CE6D4" : "#009E91";

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
        gap: showWordmark ? gap : 0,
        height: dimension,
        lineHeight: 1,
        verticalAlign: "middle",
      }}
    >
      {!iconFailed && (
        <img
          src="/uxnest-icon.png?v=5"
          alt=""
          aria-hidden="true"
          width={dimension}
          height={dimension}
          decoding="async"
          onError={() => setIconFailed(true)}
          style={{ width: dimension, height: dimension, objectFit: "contain", flexShrink: 0, display: "block" }}
        />
      )}
      {showWordmark && (!dark && !wordmarkFailed ? (
        <img
          src="/uxnest-wordmark.png?v=5"
          alt=""
          aria-hidden="true"
          height={textHeight}
          decoding="async"
          onError={() => setWordmarkFailed(true)}
          style={{ height: textHeight, width: "auto", objectFit: "contain", maxWidth: "none", display: "block" }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
            fontSize: Math.round(dimension * 0.84),
            fontWeight: 850,
            letterSpacing: "-0.045em",
            lineHeight: 1,
          }}
        >
          <span style={{ color: wordColor }}>UX</span>
          <span style={{ color: nestColor }}>Nest</span>
        </span>
      ))}
    </span>
  );
}
