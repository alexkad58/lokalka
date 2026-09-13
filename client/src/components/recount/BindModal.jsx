export default function BindModal({
  bindModalOpen,
  closeBindModal,
  bindTargetBarcode,
  unresolvedBarcode,
  candidateItems,
  bindBarcodeToSelectedItem,
  bindSearch,
  setBindSearch,
  bindFilteredItems
}) {
  if (!bindModalOpen) return null;

  return (
    <div className="modal-backdrop" onClick={closeBindModal}>
      <div className="modal-card" onClick={event => event.stopPropagation()}>
        <h3>Привязать штрихкод {bindTargetBarcode || unresolvedBarcode}</h3>
        {candidateItems.length ? (
          <>
            <div className="line mini">Ранее встречались варианты:</div>
            <div className="bind-item-list">
              {candidateItems.map(item => (
                <button
                  key={`candidate-${item.code}`}
                  type="button"
                  className="bind-item-row"
                  onClick={() => void bindBarcodeToSelectedItem(item.code)}
                >
                  <span className="bind-item-code">{item.code}</span>
                  <span className="bind-item-name">{item.name}</span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        <input
          value={bindSearch}
          onChange={event => setBindSearch(event.target.value)}
          placeholder="Найдите товар по артикулу или названию"
          autoFocus
        />
        <div className="bind-item-list">
          {!bindFilteredItems.length ? <div className="status">Товары не найдены</div> : null}
          {bindFilteredItems.map(item => (
            <button
              key={item.code}
              type="button"
              className="bind-item-row"
              onClick={() => void bindBarcodeToSelectedItem(item.code)}
            >
              <span className="bind-item-code">{item.code}</span>
              <span className="bind-item-name">{item.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="ghost" onClick={closeBindModal}>Отмена</button>
      </div>
    </div>
  );
}
