import { useMemo } from 'react';
import { parseExpression } from '@/lib/utils';

const ROWS = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['0', '.', '⌫', '+'],
];
const OP_MAP = { '÷': '/', '×': '*' };
const OP_KEYS = new Set(['÷', '×', '-', '+']);

export default function CalcKeypad({ value, onInput, onConfirm, onClose }) {
  const evaluated = useMemo(() => parseExpression(value), [value]);
  const showPreview = !isNaN(evaluated) && value && value !== String(evaluated);

  const handleKey = (key) => {
    if (key === '⌫') {
      onInput(value.slice(0, -1));
    } else {
      onInput(value + (OP_MAP[key] ?? key));
    }
  };

  const handleConfirm = () => {
    const v = parseExpression(value);
    if (!isNaN(v) && v >= 0) {
      onConfirm(String(v));
    } else {
      onClose();
    }
  };

  return (
    <>
      <div className="calc-keypad__backdrop" onClick={onClose} />
      <div className="calc-keypad">
        <div className="calc-keypad__display">
          <span className="calc-keypad__expr">{value || '0'}</span>
          {showPreview && (
            <span className="calc-keypad__preview">= {evaluated.toLocaleString()}</span>
          )}
        </div>
        <div className="calc-keypad__grid">
          {ROWS.flat().map((key) => (
            <button
              key={key}
              type="button"
              className={`calc-keypad__btn${OP_KEYS.has(key) ? ' is-op' : ''}${key === '⌫' ? ' is-del' : ''}`}
              onClick={() => handleKey(key)}
            >
              {key}
            </button>
          ))}
          <button
            type="button"
            className="calc-keypad__btn is-eq"
            onClick={handleConfirm}
          >
            =
          </button>
        </div>
      </div>
    </>
  );
}
