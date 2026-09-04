import './ui.css';

export function Badge({
  children,
  tono,
}: {
  children: React.ReactNode;
  tono: 'mover' | 'mantener' | 'activo' | 'inactivo' | 'modelo';
}) {
  return <span className={`badge badge-${tono}`}>{children}</span>;
}
