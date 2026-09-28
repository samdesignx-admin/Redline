export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  if (!showWordmark) {
    return (
      <img className={className} src="/uxnest-mark.svg" alt="UXNest"
        style={{ width: size, height: size, display: "block", flexShrink: 0, objectFit: "contain" }} />
    );
  }
  const height = size;
  const width = Math.round(size * 900 / 260);
  return (
    <img className={className} src={dark ? "/uxnest-logo-dark.svg" : "/uxnest-logo.svg"} alt="UXNest"
      style={{ width, height, display: "block", flexShrink: 0, objectFit: "contain" }} />
  );
}
