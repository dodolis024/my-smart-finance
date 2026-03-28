import { useCallback } from 'react';
import { formatNumberWithCommas, parseFormattedNumber } from '@/lib/utils';

export function useAmountInput(amountRef, setForm) {
  const handleAmountChange = useCallback((e) => {
    const input = e.target;
    const cursorPos = input.selectionStart;
    const oldValue = input.value;
    const formatted = formatNumberWithCommas(oldValue);

    const commasBefore = (oldValue.substring(0, cursorPos).match(/,/g) || []).length;
    const newCommasBefore = (formatted.substring(0, cursorPos).match(/,/g) || []).length;
    const adjust = newCommasBefore - commasBefore;
    const newCursorPos = cursorPos + adjust;

    setForm((prev) => ({ ...prev, amount: formatted }));

    requestAnimationFrame(() => {
      if (amountRef.current) {
        amountRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    });
  }, [amountRef, setForm]);

  const handleAmountBlur = useCallback((e) => {
    const value = e.target.value.trim();
    if (value) {
      setForm((prev) => ({ ...prev, amount: formatNumberWithCommas(value) }));
    }
  }, [setForm]);

  const handleAmountPaste = useCallback((e) => {
    e.preventDefault();
    const pastedText = (e.clipboardData || window.clipboardData).getData('text');
    const cleaned = parseFormattedNumber(pastedText);
    if (cleaned) {
      const formatted = formatNumberWithCommas(cleaned);
      setForm((prev) => ({ ...prev, amount: formatted }));
      requestAnimationFrame(() => {
        if (amountRef.current) {
          amountRef.current.setSelectionRange(formatted.length, formatted.length);
        }
      });
    }
  }, [amountRef, setForm]);

  return { handleAmountChange, handleAmountBlur, handleAmountPaste };
}
