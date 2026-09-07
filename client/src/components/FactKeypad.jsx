import { forwardRef, useRef } from 'react';

const FACT_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'];

const FactKeypad = forwardRef(function FactKeypad({ onAppend, onErase, onKeepOpen }, ref) {
  const lastPointerKeyTsRef = useRef(0);

  function commitKey(key) {
    if (key === '⌫') {
      onErase?.();
      return;
    }
    onAppend?.(key);
  }

  function handleContainerPointerDownCapture(event) {
    onKeepOpen?.('container_down');
    if (event.pointerType !== 'mouse') {
      event.preventDefault();
    }
  }

  function handleContainerPointerUpCapture() {
    onKeepOpen?.('container_up');
  }

  function handleContainerPointerCancelCapture() {
    onKeepOpen?.('container_cancel');
  }

  function handleKeyPointerDown(event, key) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault();
    lastPointerKeyTsRef.current = Date.now();
    onKeepOpen?.('key_down');
    commitKey(key);
  }

  function handleKeyClick(key) {
    if (Date.now() - lastPointerKeyTsRef.current < 450) return;
    commitKey(key);
  }

  return (
    <div
      ref={ref}
      className="fact-keypad"
      onPointerDownCapture={handleContainerPointerDownCapture}
      onPointerUpCapture={handleContainerPointerUpCapture}
      onPointerCancelCapture={handleContainerPointerCancelCapture}
    >
      <div className="fact-keypad-grid">
        {FACT_KEYS.map(key => (
          <button
            key={key}
            type="button"
            onPointerDown={event => handleKeyPointerDown(event, key)}
            onClick={() => handleKeyClick(key)}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
});

export default FactKeypad;