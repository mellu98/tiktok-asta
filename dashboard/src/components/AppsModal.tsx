import { useMemo, useState } from "react";

interface Props {
  loading: boolean;
  items: string[];
  onLaunch: (pkg: string) => void;
  onClose: () => void;
}

export function AppsModal({ loading, items, onLaunch, onClose }: Props) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((p) => p.toLowerCase().includes(q)) : items;
  }, [items, query]);

  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal apps" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>App installate ({items.length})</strong>
          <button className="btn small" onClick={onClose}>
            ✕ Chiudi
          </button>
        </div>
        <input
          className="search"
          type="text"
          placeholder="Cerca package…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="app-list">
          {loading ? (
            <div className="dim">Caricamento…</div>
          ) : filtered.length === 0 ? (
            <div className="dim">Nessuna app trovata</div>
          ) : (
            filtered.map((pkg) => (
              <div key={pkg} className="app-row">
                <code>{pkg}</code>
                <button className="btn small" onClick={() => onLaunch(pkg)}>
                  Apri
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
