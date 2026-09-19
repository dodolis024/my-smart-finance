import { useCallback, useMemo } from 'react';
import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip } from 'chart.js';
import { getChartPalette, buildCategoryColorMap } from '@/lib/categoryColor';
import { useTheme } from '@/hooks/useTheme';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';

ChartJS.register(ArcElement, Tooltip);

export default function CategoryChart({ history = [], incomeCategories = [], onSelectCategory, periodName }) {
  const { theme } = useTheme();
  const { t } = useLanguage();
  const { toDisplay, formatTotal } = useDisplayAmount();
  const palette = getChartPalette(theme);

  const pairs = useMemo(() => {
    const incomeSet = new Set(incomeCategories);
    const byCat = {};
    (history || []).forEach((tx) => {
      const cat = (tx.category && String(tx.category).trim()) ? tx.category : t('transaction.uncategorized');
      if (incomeSet.has(cat)) return;
      const amt = toDisplay(tx).value;
      if (!byCat[cat]) byCat[cat] = { value: 0, txs: [] };
      byCat[cat].value += amt;
      byCat[cat].txs.push(tx);
    });
    return Object.entries(byCat)
      .map(([label, { value, txs }]) => ({ label, value, txs }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [history, incomeCategories, t, toDisplay]);

  // 占比分母：與圓餅圖切片一致（都取絕對值）
  const totalExpense = useMemo(
    () => pairs.reduce((sum, p) => sum + Math.abs(p.value), 0),
    [pairs]
  );

  const handleSelect = useCallback((pair) => {
    if (!pair || !onSelectCategory) return;
    onSelectCategory({ ...pair, totalExpense });
  }, [onSelectCategory, totalExpense]);

  // 與交易列表共用同一份對應，同一個分類在兩邊必定同色
  const colorMap = useMemo(
    () => buildCategoryColorMap(history, incomeCategories, palette, t('transaction.uncategorized')),
    [history, incomeCategories, palette, t]
  );

  const chartData = useMemo(() => ({
    labels: pairs.map((p) => p.label),
    datasets: [{
      data: pairs.map((p) => Math.abs(p.value)),
      backgroundColor: pairs.map((p) => colorMap.get(p.label) ?? palette[0]),
      borderColor: '#fff',
      borderWidth: 2,
      hoverOffset: 6,
    }],
  }), [pairs, colorMap, palette]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: true,
    layout: { padding: 8 },
    onClick: (_evt, elements) => {
      if (!elements || elements.length === 0) return;
      handleSelect(pairs[elements[0].index]);
    },
    onHover: (evt, elements) => {
      const target = evt?.native?.target;
      if (target) target.style.cursor = elements.length ? 'pointer' : 'default';
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        displayColors: false,
        callbacks: {
          title: () => '',
          label: (ctx) => {
            const total = (ctx.dataset.data || []).reduce((s, v) => s + Math.abs(v || 0), 0);
            const val = Math.abs(ctx.dataset.data[ctx.dataIndex] || 0);
            const pct = total ? (val / total) * 100 : 0;
            return `${ctx.label}: ${pct.toFixed(1)}%`;
          },
        },
      },
    },
  }), [handleSelect, pairs]);

  if (pairs.length === 0) {
    return <p className="category-stats-empty">{t('dashboard.noExpenseData', { period: periodName })}</p>;
  }

  const colors = pairs.map((_, i) => palette[i % palette.length]);
  const clickable = !!onSelectCategory;

  return (
    <>
      <div className="category-chart">
        <Doughnut data={chartData} options={chartOptions} />
      </div>
      <ul className="category-stats-list" id="categoryStats">
        {pairs.map((p, i) => (
          <li
            key={p.label}
            className={clickable ? 'clickable' : ''}
            role={clickable ? 'button' : undefined}
            tabIndex={clickable ? 0 : undefined}
            onClick={clickable ? () => handleSelect(p) : undefined}
            onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelect(p); } } : undefined}
          >
            <span className="cat-name">
              <span className="cat-color" style={{ background: colors[i] }} />
              {p.label}
            </span>
            <span className="cat-amount">{formatTotal(p.value)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
