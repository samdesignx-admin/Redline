export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  if (!showWordmark) {
    return (
      <img
        className={className}
        src="/uxnest-icon.png"
        alt="UXNest"
        style={{
          width: size,
          height: size,
          display: "block",
          flexShrink: 0,
          objectFit: "contain",
        }}
      />
    );
  }

  // The approved PNG is 900 × 260. Keep its native 3.4615:1 ratio.
  const height = size;
  const width = Math.round(size * 900 / 260);

  return (
    <img
      className={className}
      src="/uxnest-logo.png"
      alt="UXNest"
      style={{
        width,
        height,
        display: "block",
        flexShrink: 0,
        objectFit: "contain",
        background: dark ? "#FFFFFF" : "transparent",
        borderRadius: dark ? 8 : 0,
      }}
    />
  );
}
