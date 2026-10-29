import { useState } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';
import { monthsBetween } from '@/lib/spendingAnalysis';

const AUTO = 'auto';

/**
 * 改分析起點的小框（放在「平常」卡片裡）：選開始記帳那個月到這個月之間的任一個月，或自動。
 * 按儲存就收起來，數字當下換成新的起點算；雲端存檔由頁面在背景跑。
 *
 * @param {string|null} startYm 目前存的起點；null 是自動
 * @param {string} firstYm 帳本第一筆交易的月份（最早可以選到這裡）
 * @param {string} currentYm 這個月（最晚可以選到這裡）
 * @param {(ym: string) => string} labelOfYm 'YYYY-MM' → 「2026年1月」
 * @param {(startYm: string|null) => void} onSave
 * @param {() => void} onCancel
 */
export default function AnalysisStartForm({ startYm, firstYm, currentYm, labelOfYm, onSave, onCancel }) {
  const { t } = useLanguage();
  // 起點比開始記帳還早（例如舊的交易刪掉了）時，實際是從開始記帳那個月算
  const [value, setValue] = useState(!startYm ? AUTO : startYm < firstYm ? firstYm : startYm);
  const options = monthsBetween(firstYm, currentYm).reverse();

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(value === AUTO ? null : value);
  };

  return (
    <form className="analysis-start__form" onSubmit={handleSubmit}>
      <label className="analysis-start__label" htmlFor="analysis-start-select">{t('spendingAnalysis.start.label')}</label>
      <select
        id="analysis-start-select"
        className="analysis-input analysis-start__select"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus
      >
        <option value={AUTO}>{t('spendingAnalysis.start.auto')}</option>
        {options.map((ym) => <option key={ym} value={ym}>{labelOfYm(ym)}</option>)}
      </select>
      <div className="analysis-start__actions">
        <button type="submit" className="analysis-btn analysis-btn--primary">
          {t('spendingAnalysis.start.save')}
        </button>
        <button type="button" className="analysis-btn analysis-btn--quiet" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
