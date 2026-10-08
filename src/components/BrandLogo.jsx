import React from "react";

export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  const [logoFailed, setLogoFailed] = React.useState(false);
  const textColor = dark ? "#FFFFFF" : "#18211F";

  if (!showWordmark) {
    return (
      <img
        className={className}
        src="/uxnest-icon.png?v=2"
        alt="UXNest"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
        style={{ width: size, height: size, display: "block", flexShrink: 0, objectFit: "contain" }}
      />
    );
  }

  const height = size;
  const width = Math.round(size * 3);

  if (logoFailed) {
    return (
      <span
        className={className}
        aria-label="UXNest"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: Math.max(6, Math.round(size * 0.25)),
          height,
          color: textColor,
          fontWeight: 800,
          fontSize: Math.max(16, Math.round(size * 0.72)),
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        <img
          src="/uxnest-icon.png?v=2"
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
          style={{ width: size, height: size, display: "block", flexShrink: 0, objectFit: "contain" }}
        />
        <span>UXNest</span>
      </span>
    );
  }

  return (
    <img
      className={className}
      src="/uxnest-logo.png?v=2"
      alt="UXNest"
      loading="eager"
      onError={() => setLogoFailed(true)}
      style={{ width, height, display: "block", flexShrink: 0, objectFit: "contain" }}
    />
  );
}
