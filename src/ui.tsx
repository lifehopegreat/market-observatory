import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Database, X } from 'lucide-react';

export function Modal({ title, subtitle, children, onClose, wide = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = dialog.current; d?.showModal(); return () => d?.close(); }, []);
  return <dialog ref={dialog} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="dialog-title">
    <header className="modal-header"><div><h2 id="dialog-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭对话框"><X size={20}/></button></header>{children}
  </dialog>;
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol"><Database size={25} strokeWidth={1.3}/></div><h3>{title}</h3><p>{text}</p>{action}</div>;
}
export function PageHeading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <header className="page-heading"><div><div className="eyebrow">{kicker}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="page-heading-action">{action}</div>}</header>;
}
export function External({ href, children }: { href: string; children: ReactNode }) { return <a className="external-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13}/></a>; }
