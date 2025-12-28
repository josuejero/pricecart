export type AttributionItem = {
  id: string;
  text: string;
  href: string;
};

export function AttributionFooter(props: { items: AttributionItem[] }) {
  if (!props.items.length) return null;

  return (
    <footer
      role="contentinfo"
      aria-label="Provider attributions"
      style={{ marginTop: 32, borderTop: "1px solid #eee", paddingTop: 12, fontSize: 12 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {props.items.map((item, index) => (
          <span key={item.id}>
            <a href={item.href} target="_blank" rel="noreferrer">
              {item.text}
            </a>
            {index < props.items.length - 1 ? " · " : ""}
          </span>
        ))}
      </div>
    </footer>
  );
}
