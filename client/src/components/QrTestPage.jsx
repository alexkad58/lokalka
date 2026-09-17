export default function QrTestPage({
  scannerOn,
  toggleScanner,
  torchOn,
  toggleTorch,
  videoRef,
  focusScannerCamera,
  handleScannerDoubleClick,
  scannerStatus,
  lastCode,
  onReset,
  decoderProgress,
  transferStatus,
  transferError,
  decodedBytes,
  close
}) {
  return (
    <main className="qr-test-page">
      <header className="qr-test-header">
        <div>
          <p className="eyebrow">LOKALKA / QR TEST</p>
          <h1>Тест TXQR-сканера</h1>
          <p>Наведите камеру на анимированный QR с offline-страницы.</p>
        </div>
        <button type="button" className="ghost" onClick={close}>Назад</button>
      </header>

      <section className="qr-test-grid">
        <section className="qr-test-camera panel">
          <div
            className={`qr-test-viewport ${scannerOn ? 'active' : ''}`}
            onClick={() => void focusScannerCamera()}
            onDoubleClick={handleScannerDoubleClick}
          >
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="scanner-guide" />
          </div>
          <div className="scanner-meta">
            <span>{scannerStatus}</span>
            <span className="scanner-last">{lastCode || 'TXQR'}</span>
          </div>
          <div className="qr-test-actions">
            <button type="button" className={scannerOn ? 'active' : ''} onClick={toggleScanner}>
              {scannerOn ? 'Остановить' : 'Сканер'}
            </button>
            <button type="button" className={torchOn ? 'active' : 'ghost'} onClick={toggleTorch}>Фонарик</button>
            <button type="button" className="ghost" onClick={onReset}>Сбросить</button>
          </div>
        </section>

        <section className="qr-test-results panel" aria-live="polite">
          <div className={`qr-test-status ${transferStatus === 'ok' ? 'ok' : transferStatus === 'error' ? 'error' : ''}`}>
            <span className="status-dot" />
            <strong>{transferStatus === 'ok' ? 'Файл восстановлен' : transferStatus === 'error' ? 'Ошибка передачи' : 'Ожидание передачи'}</strong>
          </div>
          <div className="qr-test-progress-head">
            <span>Прогресс</span>
            <strong>{decoderProgress.percent}%</strong>
          </div>
          <progress value={decoderProgress.percent} max="100" />
          <dl className="qr-test-stats">
            <div><dt>Получено кадров</dt><dd>{decoderProgress.received}</dd></div>
            <div><dt>Получено / нужно</dt><dd>{decoderProgress.received} / {decoderProgress.required || '-'}</dd></div>
            <div><dt>Размер результата</dt><dd>{decodedBytes ? `${decodedBytes.length} Б` : '-'}</dd></div>
          </dl>
          <p className="qr-test-message">{transferError || (lastCode ? `Последний кадр: ${lastCode.slice(0, 28)}...` : 'Кадры появятся после запуска камеры.')}</p>
        </section>
      </section>
    </main>
  );
}