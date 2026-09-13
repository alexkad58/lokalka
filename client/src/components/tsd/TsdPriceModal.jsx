export default function TsdPriceModal({
  tsdPriceModalOpen,
  setTsdPriceModalOpen,
  tsdResult,
  tsdPriceInput,
  setTsdPriceInput,
  confirmTsdPrice
}) {
  if (!tsdPriceModalOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setTsdPriceModalOpen(false)}>
      <div className="modal-card" onClick={event => event.stopPropagation()}>
        <h3>Цена товара</h3>
        <div className="line mini">Штрихкод: {tsdResult?.barcode}</div>
        <input
          value={tsdPriceInput}
          onChange={event => setTsdPriceInput(event.target.value)}
          inputMode="decimal"
          placeholder="00.00 или 00,00"
          autoFocus
        />
        <button type="button" onClick={confirmTsdPrice}>Сформировать QR-код</button>
        <button type="button" className="ghost" onClick={() => setTsdPriceModalOpen(false)}>Отмена</button>
      </div>
    </div>
  );
}
