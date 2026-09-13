import { detectPackageType, getPackageTypeLabel } from '../../utils/products.js';

export default function ItemsFeed({
  itemsFeedRef,
  activeFactCode,
  filteredItems,
  computeRowState,
  values,
  itemCardRefs,
  updateFact,
  handleFactFocus,
  handleFactBlur
}) {
  return (
    <main ref={itemsFeedRef} className={`items-feed ${activeFactCode ? 'keypad-open' : ''}`}>
      {filteredItems.map(item => {
        const row = computeRowState(item, values);
        const packageType = detectPackageType(item.name);

        return (
          <article
            key={item.code}
            ref={card => {
              if (card) itemCardRefs.current.set(item.code, card);
              else itemCardRefs.current.delete(item.code);
            }}
            className={`item-card ${row.status}`}
          >
            <div className="line">{item.name}</div>
            <div className="line mini">
              <strong>Ед:</strong>{' '}
              <span
                className={`pack-icon ${packageType}`}
                title={getPackageTypeLabel(packageType)}
                aria-label={getPackageTypeLabel(packageType)}
              />
              <span>{item.unit || '—'}</span>
              {' '}| <strong>Цена:</strong> {item.price ?? '—'}
              {' '}| <strong>Код:</strong> {item.code}
            </div>
            <div className="line mini"><strong>По документам:</strong> {item.docQty ?? '—'} | <strong>Разница:</strong> {row.delta === null ? '—' : row.delta}</div>
            <input
              className={`fact-input ${activeFactCode === item.code ? 'active' : ''}`}
              value={row.raw}
              onChange={event => updateFact(item.code, event.target.value)}
              onFocus={() => handleFactFocus(item.code)}
              onClick={() => handleFactFocus(item.code)}
              onBlur={handleFactBlur}
              readOnly
              type="text"
              inputMode="none"
              pattern="[0-9+]*"
              placeholder="Фактическое количество"
            />
          </article>
        );
      })}
    </main>
  );
}
