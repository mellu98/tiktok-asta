import type { ScreenshotResult } from "../../../src/shared/types";

interface Props {
  shot: ScreenshotResult;
  onClose: () => void;
}

export function ScreenshotModal({ shot, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Screenshot</strong>
          <button className="btn small" onClick={onClose}>
            ✕ Chiudi
          </button>
        </div>
        <img
          className="shot"
          src={shot.dataUrl}
          alt="Screenshot del dispositivo"
        />
        <p className="note">
          Salvato in <code>{shot.file}</code> ·{" "}
          <a
            href={shot.dataUrl}
            download={shot.file.split("/").pop() ?? "screenshot.png"}
          >
            Scarica PNG
          </a>
        </p>
      </div>
    </div>
  );
}
