import TsdPriceModal from './TsdPriceModal.jsx';

export default function TsdPage({
  scanSuccessFlash,
  scannerOn,
  toggleScanner,
  torchOn,
  toggleTorch,
  videoRef,
  focusScannerCamera,
  handleScannerDoubleClick,
  scannerStatus,
  lastCode,
  tsdResult,
  tsdQrDataUrl,
  tsdBarcodeDataUrl,
  closeTsd,
  tsdPriceModalOpen,
  setTsdPriceModalOpen,
  tsdPriceInput,
  setTsdPriceInput,
  confirmTsdPrice
}) {
  return (
    <div className="tsd-page">
      <header className={`scanner-shell tsd-scanner ${scanSuccessFlash ? 'scan-success-flash' : ''}`}>
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
          <span>{scannerStatus}</span>
          <span className="scanner-last">{lastCode || 'ТСД'}</span>
        </div>
      </header>

      <section className="tsd-result">
        {!tsdResult ? <div className="status">Отсканируйте QR-код или штрихкод</div> : null}
        {tsdResult ? (
          <>
            <div className="tsd-result-code">{tsdResult.raw || tsdResult.barcode}</div>
            <div className="tsd-code-visuals">
              {tsdQrDataUrl ? <img src={tsdQrDataUrl} alt="QR-код" /> : null}
              {tsdBarcodeDataUrl ? <img src={tsdBarcodeDataUrl} alt="Штрихкод" /> : null}
            </div>
            <div className="tsd-result-meta">
              <span>Штрихкод: {tsdResult.barcode}</span>
              <span>Цена: {tsdResult.price}</span>
              <span>Дата: {tsdResult.date}</span>
            </div>
          </>
        ) : null}
      </section>

      <nav className="bottom-actions tsd-actions">
        <button type="button" className={scannerOn ? 'active' : ''} onClick={toggleScanner}>
          {scannerOn ? 'Остановить' : 'Сканер'}
        </button>
        <button type="button" className={torchOn ? 'active' : ''} onClick={toggleTorch}>Фонарик</button>
        <button type="button" onClick={closeTsd}>Назад</button>
      </nav>

      <TsdPriceModal
        tsdPriceModalOpen={tsdPriceModalOpen}
        setTsdPriceModalOpen={setTsdPriceModalOpen}
        tsdResult={tsdResult}
        tsdPriceInput={tsdPriceInput}
        setTsdPriceInput={setTsdPriceInput}
        confirmTsdPrice={confirmTsdPrice}
      />
    </div>
  );
}
