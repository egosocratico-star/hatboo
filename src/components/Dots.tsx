/** Tres puntos que se mueven, en vez de hacer parpadear el texto: el texto que
 *  se está leyendo no debe cambiar de opacidad (y con movimiento reducido
 *  cualquier `animate-pulse` acababa siendo un estroboscopio). */
export default function Dots({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1 w-1 rounded-full bg-accent-soft animate-dot"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  );
}
