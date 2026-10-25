import { useEffect } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={wide ? 'modal wide' : 'modal'} role="dialog" aria-label={title}>
        <header><h3>{title}</h3><button className="icon-btn" onClick={onClose} title="Close"><X size={18} /></button></header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
