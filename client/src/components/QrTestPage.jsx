export default function QrTestPage({
  scannerOn,
  startScanner,
  videoRef,
  focusScannerCamera,
  scannerStatus,
  decoderProgress,
  transferStatus,
  transferError,
  decodedPayload,
  close
}) {
  const statusText = transferError
    || (transferStatus === 'uploading'
      ? 'Создаем просчет...'
      : scannerOn ? scannerStatus : 'Нажмите для включения');

  return (
    <main className="qr-test-page">
      <header className="qr-test-header">
        <h1>QR-сканер</h1>
        <button type="button" className="ghost" onClick={close}>Назад</button>
      </header>

      <section className="qr-test-camera">
        <button
          type="button"
          className={`qr-test-viewport ${scannerOn ? 'active' : ''}`}
          onClick={() => scannerOn ? void focusScannerCamera() : void startScanner()}
          aria-label={scannerOn ? 'Сфокусировать камеру' : 'Включить камеру'}
        >
          <video ref={videoRef} autoPlay muted playsInline />
          {scannerOn ? <div className="scanner-guide" /> : <span>Нажмите для включения</span>}
        </button>
        <div className="qr-test-summary" aria-live="polite">
          <div className={`qr-test-status ${transferStatus === 'ok' || transferStatus === 'uploading' ? 'ok' : transferStatus === 'error' ? 'error' : ''}`}>
            <span className="status-dot" />
            <strong>{statusText}</strong>
          </div>
          <div className="qr-test-progress-head">
            <span>{decodedPayload ? `${decodedPayload.items.length} позиций` : `${decoderProgress.received} / ${decoderProgress.required || '-'}`}</span>
            <strong>{decoderProgress.percent}%</strong>
          </div>
          <progress value={decoderProgress.percent} max="100" />
        </div>
      </section>
    </main>
  );
}