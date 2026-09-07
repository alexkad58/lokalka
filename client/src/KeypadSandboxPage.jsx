import { useEffect, useMemo, useRef, useState } from 'react';
import {
  sanitizeFactExpression as sanitizeFactExpressionUtil,
  sumFactExpression as sumFactExpressionUtil
} from '../../shared/recount-utils.js';
import FactKeypad from './components/FactKeypad';

const DEMO_ITEMS = [
  { code: '101', name: 'Водка немироff клюква ледяная 0,25л 40%', docQty: 5, price: 420, unit: 'шт' },
  { code: '102', name: 'Пиво балтика №7 0,44л 4% ж/б', docQty: 12, price: 110, unit: 'шт' },
  { code: '103', name: 'Сок яблочный 1л', docQty: 7, price: 145, unit: 'шт' },
  { code: '104', name: 'Минеральная вода 0,5л', docQty: 20, price: 62, unit: 'шт' }
];

function sanitizeFactExpression(value) {
  return sanitizeFactExpressionUtil(value);
}

function sumFactExpression(value) {
  return sumFactExpressionUtil(value);
}

function safeNumber(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeRowState(item, valueMap) {
  const raw = sanitizeFactExpression(valueMap[item.code] ?? '');
  const manualFact = sumFactExpression(raw);
  const hasManual = raw.length > 0 && manualFact !== null;
  const docQty = safeNumber(item.docQty);
  const fact = hasManual ? manualFact : null;
  const delta = fact === null ? null : fact - docQty;
  const status = delta === null ? '' : delta === 0 ? 'match' : delta < 0 ? 'missing' : 'excess';
  return { raw, fact, delta, status };
}

export default function KeypadSandboxPage({ onClose }) {
  const [search, setSearch] = useState('');
  const [values, setValues] = useState({});
  const [activeFactCode, setActiveFactCode] = useState('101');
  const [status, setStatus] = useState('Тестовый режим клавиатуры: проверьте быстрые тапы и попадание между кнопками');

  const blurGuardUntilRef = useRef(0);
  const keypadRef = useRef(null);
  const itemsFeedRef = useRef(null);
  const itemCardRefs = useRef(new Map());

  const filteredItems = useMemo(() => {
    const q = String(search || '').toLowerCase().trim();
    if (!q) return DEMO_ITEMS;
    return DEMO_ITEMS.filter(item => (
      item.name.toLowerCase().includes(q) || String(item.code).includes(q)
    ));
  }, [search]);

  useEffect(() => {
    if (!activeFactCode) return undefined;

    const scrollActiveCard = () => {
      const feed = itemsFeedRef.current;
      const card = itemCardRefs.current.get(activeFactCode);
      const keypad = keypadRef.current;
      if (!feed || !card || !keypad) return;

      const cardRect = card.getBoundingClientRect();
      const keypadRect = keypad.getBoundingClientRect();
      const scrollDelta = cardRect.bottom - keypadRect.top;
      feed.scrollTo({ top: Math.max(0, feed.scrollTop + scrollDelta), behavior: 'smooth' });
    };

    const timer = window.setTimeout(scrollActiveCard, 120);
    return () => window.clearTimeout(timer);
  }, [activeFactCode]);

  useEffect(() => {
    if (!activeFactCode) return undefined;

    const closeKeypadOnOutsidePointerDown = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.fact-keypad, .fact-input')) return;
      setActiveFactCode('');
    };

    document.addEventListener('pointerdown', closeKeypadOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', closeKeypadOnOutsidePointerDown, true);
  }, [activeFactCode]);

  function keepOpenFromKeypad() {
    blurGuardUntilRef.current = Date.now() + 600;
  }

  function handleFactBlur() {
    if (Date.now() < blurGuardUntilRef.current) return;
    setActiveFactCode('');
  }

  function appendToActiveFact(char) {
    if (!activeFactCode) return;
    setValues(prev => {
      const current = String(prev[activeFactCode] ?? '');
      if (char === '+') {
        if (!current || current.endsWith('+')) return prev;
        return { ...prev, [activeFactCode]: sanitizeFactExpression(`${current}+`) };
      }
      return { ...prev, [activeFactCode]: sanitizeFactExpression(`${current}${char}`) };
    });
  }

  function eraseActiveFact() {
    if (!activeFactCode) return;
    setValues(prev => {
      const current = String(prev[activeFactCode] ?? '');
      return { ...prev, [activeFactCode]: sanitizeFactExpression(current.slice(0, -1)) };
    });
  }

  function saveDemo() {
    setStatus('Демо-сохранение выполнено');
  }

  return (
    <div className="recount-page keypad-lab-page">
      <div className="recount-top">
        <header className="scanner-shell keypad-lab-header">
          <div className="scanner-meta">
            <span>Локальный тест клавиатуры (iPhone Safari)</span>
            <span className="scanner-last">{activeFactCode ? `Активный код: ${activeFactCode}` : 'Поле не выбрано'}</span>
          </div>
          <div className="scanner-unresolved keypad-lab-status">
            <span>{status}</span>
          </div>
        </header>

        <section className="search-block">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Поиск в демо-товарах"
          />
        </section>
      </div>

      <main ref={itemsFeedRef} className={`items-feed ${activeFactCode ? 'keypad-open' : ''}`}>
        {filteredItems.map(item => {
          const row = computeRowState(item, values);
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
              <div className="line mini">Код: {item.code} | По документам: {item.docQty} | Цена: {item.price}</div>
              <input
                className={`fact-input ${activeFactCode === item.code ? 'active' : ''}`}
                value={row.raw}
                onFocus={() => setActiveFactCode(item.code)}
                onClick={() => setActiveFactCode(item.code)}
                onBlur={handleFactBlur}
                readOnly
                type="text"
                inputMode="none"
                placeholder="Фактическое количество"
              />
            </article>
          );
        })}
      </main>

      <nav className="bottom-actions">
        <button type="button" onClick={saveDemo}>Сохранить (демо)</button>
        <button type="button" onClick={() => setValues({})}>Сбросить</button>
        <button type="button" className="ghost" onClick={onClose}>Назад</button>
      </nav>

      {activeFactCode ? (
        <FactKeypad
          ref={keypadRef}
          value={values[activeFactCode] || ''}
          onAppend={appendToActiveFact}
          onErase={eraseActiveFact}
          onKeepOpen={keepOpenFromKeypad}
        />
      ) : null}
    </div>
  );
}