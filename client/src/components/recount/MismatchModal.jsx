export default function MismatchModal({
  mismatchModalOpen,
  setMismatchModalOpen,
  mismatchFilter,
  setMismatchFilter,
  mismatchItems
}) {
  if (!mismatchModalOpen) return null;

  return (
    <div className="modal-backdrop" onClick={() => setMismatchModalOpen(false)}>
      <div className="modal-card" onClick={event => event.stopPropagation()}>
        <h3>Позиции с расхождениями</h3>
        <div className="mismatch-filters">
          <button
            type="button"
            className={mismatchFilter === 'all' ? 'active' : 'ghost'}
            onClick={() => setMismatchFilter('all')}
          >
            Все
          </button>
          <button
            type="button"
            className={mismatchFilter === 'missing' ? 'active' : 'ghost'}
            onClick={() => setMismatchFilter('missing')}
          >
            Пропущено
          </button>
        </div>
        {!mismatchItems.length ? <div className="status">Расхождений нет</div> : null}
        {mismatchItems.length ? (
          <div className="compact-table-wrap">
            <table className="compact-table">
              <colgroup>
                <col className="col-name" />
                <col className="col-num" />
                <col className="col-num" />
                <col className="col-num" />
              </colgroup>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Остаток</th>
                  <th>Факт</th>
                  <th>Разница</th>
                </tr>
              </thead>
              <tbody>
                {mismatchItems.map(item => {
                  const factClass = item.delta === null ? 'num-neutral' : item.delta < 0 ? 'num-negative' : 'num-positive';
                  const deltaClass = item.delta === null ? 'num-neutral' : item.delta < 0 ? 'num-negative' : 'num-positive';
                  const deltaText = item.delta === null ? '-' : `${item.delta > 0 ? '+' : ''}${item.delta}`;
                  const factText = item.fact === null ? '-' : String(item.fact);

                  return (
                    <tr key={item.code}>
                      <td className="cell-name">{item.name}</td>
                      <td>{item.docQty ?? '-'}</td>
                      <td className={factClass}>{factText}</td>
                      <td className={deltaClass}>{deltaText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
        <button type="button" onClick={() => setMismatchModalOpen(false)}>Закрыть</button>
      </div>
    </div>
  );
}
