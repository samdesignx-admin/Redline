export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  if (!showWordmark) {
    return (
      <span
        className={className}
        style={{
          display: "inline-block",
          width: size,
          height: size,
          overflow: "hidden",
          flexShrink: 0,
          borderRadius: Math.max(6, Math.round(size * 0.22)),
        }}
      >
        <img
          src="/uxnest-logo.png"
          alt="UXNest"
          style={{
            height: size,
            width: Math.round(size * 751 / 244),
            maxWidth: "none",
            display: "block",
            objectFit: "contain",
          }}
        />
      </span>
    );
  }

  return (
    <img
      className={className}
      src={dark ? "/uxnest-logo.png" : "/uxnest-logo.png"}
      alt="UXNest"
      style={{
        width: Math.max(104, Math.round(size * 3.55)),
        height: Math.max(34, Math.round(size * 0.325)),
        display: "block",
        flexShrink: 0,
        objectFit: "contain",
        background: dark ? "#FFFFFF" : "transparent",
        borderRadius: dark ? 8 : 0,
      }}
    />
  );
}
