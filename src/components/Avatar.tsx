export function Avatar({
  url,
  name,
  size = 28,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (!url) {
    return (
      <span
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised font-display font-bold uppercase text-mute"
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        aria-hidden
      >
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-full bg-raised"
    />
  );
}
