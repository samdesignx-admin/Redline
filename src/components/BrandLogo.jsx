export default function BrandLogo({ size = 28, showWordmark = true, dark = false, className = "" }) {
  return (
    <div className={className} style={{ display: "inline-flex", alignItems: "center", gap: Math.max(7, Math.round(size * 0.28)), lineHeight: 1 }}>
      <img
        src="/uxnest-mark.svg"
        alt="UXNest"
        style={{ width: size, height: size, display: "block", flexShrink: 0 }}
      />
      {showWordmark && (
        <span style={{
          fontFamily: "'Plus Jakarta Sans', sans-serif",
          fontWeight: 800,
          fontSize: Math.max(15, Math.round(size * 0.62)),
          letterSpacing: -0.6,
          color: dark ? "#FFFFFF" : "#18211F",
          whiteSpace: "nowrap",
        }}>
          UX<span style={{ color: "#0B8B78" }}>Nest</span>
        </span>
      )}
    </div>
  );
}
