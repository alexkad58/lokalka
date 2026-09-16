export default function CodebookPage({
  user,
  error,
  codebookData,
  codebookFilter,
  setCodebookFilter,
  codebookPage,
  codebookLoading,
  codebookLoadingMore,
  codebookProducts,
  codebookFeedRef,
  codebookLoadMoreRef,
  codebookSearch,
  setCodebookSearch,
  openProductCard,
  productCard,
  setProductCard,
  productCardLoading,
  productCardError,
  productCardSaving,
  productCardDeleting,
  saveProductCard,
  deleteProductCard,
  closeCodebook
}) {
  return (
    <div className="codebook-page">
      <header className="home-header codebook-header">
        <div>
          <h2>Справочник кодов товаров</h2>
          <p>{user?.isAdmin ? 'Администратор' : 'Роль СБ'}: <strong>{user?.login || '-'}</strong></p>
        </div>
        <button type="button" className="ghost" onClick={closeCodebook}>Назад</button>
      </header>

      {error ? <section className="status error">{error}</section> : null}

      <section className="panel codebook-panel">
        <div className="home-history-head">
          <div>
            <h3>Сохранённые связи</h3>
            <p className="line mini">Загружено: {codebookData.entries?.length || 0} из {codebookData.total || 0}</p>
          </div>
          <div className="home-subtabs" role="tablist" aria-label="Фильтр привязок">
            <button type="button" className={`home-subtab ${codebookFilter === 'all' ? 'active' : ''}`} onClick={() => setCodebookFilter('all')}>Все</button>
            <button type="button" className={`home-subtab ${codebookFilter === 'conflict' ? 'active' : ''}`} onClick={() => setCodebookFilter('conflict')}>Конфликты</button>
          </div>
        </div>

        <div className="settings-field codebook-search-field">
          <label htmlFor="codebook-page-search">Поиск по коду или названию</label>
          <input id="codebook-page-search" value={codebookSearch} onChange={event => setCodebookSearch(event.target.value)} placeholder="Например: 12345" />
        </div>

        {codebookLoading ? <div className="status">Загрузка списка...</div> : null}
        {!codebookLoading ? (
          <div ref={codebookFeedRef} className="history-list codebook-feed">
            {(codebookData.entries || []).filter(entry => {
              const query = String(codebookSearch || '').trim().toLowerCase();
              const product = codebookProducts?.[String(entry.code)];
              return !query || String(entry.code).toLowerCase().includes(query) || String(product?.name || '').toLowerCase().includes(query);
            }).map(entry => {
              const product = codebookProducts?.[String(entry.code)];
              return (
                <article key={entry.code} className={`history-item ${entry.conflict ? 'conflict' : ''}`}>
                  <div className="history-item-head">
                    <div className="codebook-item-title">
                      {product?.imgPreview || product?.img ? (
                        <img src={product.imgPreview || product.img} alt="" className="codebook-item-image" />
                      ) : <span className="codebook-item-image-placeholder" />}
                      <span>
                        <strong>{product?.name || 'Загрузка товара...'}</strong>
                        <small>{entry.code}</small>
                      </span>
                    </div>
                    {entry.conflict ? <span className="status error codebook-conflict-badge">конфликт</span> : null}
                  </div>
                  <div className="line mini">ШК: {entry.barcodes.join(', ') || '—'}</div>
                  <div className="line mini">Связей: {entry.barcodeCount}</div>
                  <button type="button" className="ghost" onClick={() => openProductCard(entry.code)}>Открыть карточку</button>
                </article>
              );
            })}
          </div>
        ) : null}

        {!codebookLoading && !(codebookData.entries || []).length ? <div className="status">Нет записей по текущему фильтру</div> : null}

        <div ref={codebookLoadMoreRef} className="codebook-load-more">
          {codebookLoadingMore ? <span>Загружаем следующие товары...</span> : null}
          {!codebookLoadingMore && codebookPage < (codebookData.totalPages || 1) ? <span>Прокрутите ниже для загрузки</span> : null}
          {!codebookLoadingMore && codebookPage >= (codebookData.totalPages || 1) && codebookData.total ? <span>Все товары загружены</span> : null}
        </div>
      </section>

      {productCard ? (
        <div className="modal-backdrop" onClick={() => setProductCard(null)}>
          <div className="modal-card product-card-modal" onClick={event => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Карточка товара: {productCard.articleCode}</h3>
              <button type="button" className="ghost mini-close-btn" onClick={() => setProductCard(null)} aria-label="Закрыть">✕</button>
            </div>
            {productCardLoading ? <div className="status">Загрузка карточки...</div> : null}
            {productCardError ? <div className="status error">{productCardError}</div> : null}
            {!productCardLoading && productCard.product ? (
              <div className="product-card-layout">
                <div className="product-card-image-wrap">
                  <img src={productCard.product.imgPreview || productCard.product.img} alt={productCard.product.name || productCard.articleCode} className="product-card-image" />
                </div>
                <div className="product-card-body">
                  <h4>{productCard.product.name || 'Товар без названия'}</h4>
                  {productCard.product.description ? <p>{productCard.product.description}</p> : null}
                  <div className="line mini">Тип: {productCard.product.type || '—'}</div>
                  <div className="line mini">Литраж/граммовка: {productCard.product.measure || '—'}</div>
                  <div className="line mini">Остаток: {productCard.product.quantity ?? '—'}</div>
                  {productCard.editing ? (
                    <label className="settings-field">
                      <span>Связанные ШК</span>
                      <textarea
                        value={productCard.barcodes.join('\n')}
                        onChange={event => setProductCard({
                          ...productCard,
                          barcodes: Array.from(new Set(event.target.value.split(/[\s,;]+/).map(value => value.trim()).filter(Boolean)))
                        })}
                        rows={4}
                      />
                    </label>
                  ) : <div className="line mini">Связанные ШК: {productCard.barcodes.join(', ') || '—'}</div>}
                  <div className="product-card-actions">
                    {productCard.editing ? <button type="button" className="ghost" onClick={saveProductCard} disabled={productCardSaving}>{productCardSaving ? 'Сохранение...' : 'Сохранить'}</button> : null}
                    <button type="button" className="ghost" onClick={() => setProductCard({
                      ...productCard,
                      editing: !productCard.editing,
                      barcodes: productCard.editing ? [...(productCard.originalBarcodes || [])] : productCard.barcodes
                    })} disabled={productCardSaving || productCardDeleting}>{productCard.editing ? 'Отменить' : 'Редактировать'}</button>
                    <button type="button" className="danger" onClick={() => deleteProductCard(productCard.articleCode)} disabled={productCardDeleting}>{productCardDeleting ? 'Удаление...' : 'Удалить'}</button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
