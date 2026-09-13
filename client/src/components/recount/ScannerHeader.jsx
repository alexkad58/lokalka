import { formatRub } from '../../utils/formatting.js';

function formatBarcodeTail(barcode) {
  const text = String(barcode || '').trim();
  return text ? text.slice(-4) : '';
}

export default function ScannerHeader({
  scanSuccessFlash,
  scannerOn,
  videoRef,
  focusScannerCamera,
  handleScannerDoubleClick,
  loading,
  scannerStatus,
  progressSummary,
  unresolvedBarcode,
  candidateCodes,
  openBindModal,
  bindTargetBarcode,
  hiddenCompletedMatch
}) {
  return (
    <header className={`scanner-shell ${scanSuccessFlash ? 'scan-success-flash' : ''}`}>
      <div
        className={`scanner-viewport ${scannerOn ? 'active' : ''}`}
        onClick={() => void focusScannerCamera()}
        onDoubleClick={handleScannerDoubleClick}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
        />
        <div className="scanner-guide" />
      </div>
      <div className="scanner-meta">
        <span>{loading ? 'Подождите...' : scannerStatus}</span>
        <span className="scanner-last">
          {`${formatRub(progressSummary.totalSum)} | ${progressSummary.progressPercent}%`}
        </span>
      </div>
      {unresolvedBarcode ? (
        <div className="scanner-unresolved">
          <span>
            {candidateCodes.length > 1
              ? `ШК ...${formatBarcodeTail(unresolvedBarcode)}: несколько вариантов товара`
              : `ШК ...${formatBarcodeTail(unresolvedBarcode)} не найден`}
          </span>
          <button type="button" onClick={openBindModal}>
            {candidateCodes.length > 1 ? 'Выбрать товар' : 'Привязать вручную'}
          </button>
        </div>
      ) : null}
      {bindTargetBarcode && !unresolvedBarcode ? (
        <div className="scanner-unresolved">
          <span>Текущий ШК: ...{formatBarcodeTail(bindTargetBarcode)}</span>
          <button type="button" onClick={openBindModal}>Ручная привязка</button>
        </div>
      ) : null}
      {hiddenCompletedMatch && !unresolvedBarcode ? (
        <div className="scanner-unresolved">
          <span>Позиция найдена, но она скрыта, потому что уже отошла.</span>
        </div>
      ) : null}
    </header>
  );
}
