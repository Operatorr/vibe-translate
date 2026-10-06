export function RevealHeading({
  children,
  className,
}: {
  children: string
  className: string
}) {
  return (
    <h2 className={className} aria-label={children}>
      <span aria-hidden="true">
        {children.split(' ').map((word, index) => (
          <span key={index} className="reveal-word">
            {word}{' '}
          </span>
        ))}
      </span>
    </h2>
  )
}
