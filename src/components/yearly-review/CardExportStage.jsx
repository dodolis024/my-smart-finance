import { createPortal } from 'react-dom';

export default function CardExportStage({ stageRef, children }) {
  return createPortal(
    <div ref={stageRef} className="card-export-stage" aria-hidden="true">
      {children}
    </div>,
    document.body
  );
}
