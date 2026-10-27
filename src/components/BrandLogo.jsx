import React from "react";

// User-approved UXNest bird-and-nest horizontal lockup.
// Source artwork includes the exact UXNest wordmark and tagline.
// The compact icon is cropped from that same artwork for icon-only usage.
export default function BrandLogo({
  size = 28,
  showWordmark = true,
  dark = false,
  className = "",
}) {
  const [failed, setFailed] = React.useState(false);
  const height = Math.max(16, Number(size) || 28);
  const width = showWordmark ? Math.round(height * 4) : height;
  const url = showWordmark
    ? "/uxnest-horizontal.webp?v=7"
    : "/uxnest-bird-180.png?v=7";

  return (
    <span
      className={className}
      role="img"
      aria-label="UXNest — AI-Powered UX Intelligence"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 1,
        minWidth: 0,
        width: dark ? width + 10 : width,
        maxWidth: "100%",
        whiteSpace: "nowrap",
        lineHeight: 1,
        verticalAlign: "middle",
        background: dark ? "#fff" : "transparent",
        borderRadius: dark ? 10 : 0,
        padding: dark ? 5 : 0,
        boxSizing: "border-box",
      }}
    >
      {!failed ? (
        <img
          src={url}
          width={width}
          height={height}
          alt=""
          aria-hidden="true"
          decoding="async"
          onError={() => setFailed(true)}
          style={{
            display: "block",
            width: "100%",
            maxWidth: width,
            height: "auto",
            objectFit: "contain",
            flexShrink: 1,
          }}
        />
      ) : (
        <strong style={{
          color: dark ? "#07352E" : "#08253A",
          fontFamily: "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif",
          fontWeight: 850,
          fontSize: Math.max(14, Math.round(height * 0.68)),
          letterSpacing: "-0.045em",
        }}>
          UX<span style={{ color: "#0AAA72" }}>Nest</span>
        </strong>
      )}
    </span>
  );
}
