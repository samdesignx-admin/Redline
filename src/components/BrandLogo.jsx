export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  if (!showWordmark) {
    return (
      <img
        className={className}
        src="/uxnest-icon.png"
        alt="UXNest"
        style={{ width: size, height: size, display: "block", flexShrink: 0, objectFit: "contain" }}
      />
    );
  }

  const height = size;
  const width = Math.round(size * 376 / 122);

  return (
    <img
      className={className}
      src="/uxnest-logo.png"
      alt="UXNest"
      style={{ width, height, display: "block", flexShrink: 0, objectFit: "contain" }}
    />
  );
}
