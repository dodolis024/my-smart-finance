import TransactionRow from './TransactionRow';
import { formatDateForDisplay } from '@/lib/utils';
import { useLanguage } from '@/contexts/LanguageContext';
import { useDisplayAmount } from '@/contexts/DisplayAmountContext';
import zhLocale from '@/locales/zh';
import enLocale from '@/locales/en';

/**
 * 一天的交易：卡片外的標題（日期、筆數、收支合計）＋ 卡片內的交易列。
 *
 * 標題刻意不是 <tr>：它是這一天的標題，不該沾到表格列的底色、框線與交錯底色。
 * 合計取自「這一天的完整交易」而非當頁切片，所以同一天被分頁切開時
 * 兩頁看到的是同一組數字。
 */
export default function TransactionDayGroup({ day, isMobile, colgroup, categoryColors, onEdit, onDelete, onShowDetail }) {
  const { t, lang } = useLanguage();
  const { formatTotal } = useDisplayAmount();
  // t() 只回傳字串，星期陣列比照 StreakCalendar 直接取語系檔
  const weekLabels = (lang === 'en' ? enLocale : zhLocale).transaction.weekLabels;
  const parsed = new Date(`${day.date}T00:00:00`);
  const weekday = isNaN(parsed) ? '' : weekLabels[parsed.getDay()];
  const displayDate = formatDateForDisplay(day.date, isMobile);

  return (
    <section className="tx-day">
      <div className="tx-day__head">
        <h3 className="tx-day__date">
          {weekday ? t('transaction.dateGroupLabel', { date: displayDate, weekday }) : displayDate}
        </h3>
        <div className="tx-day__meta">
          <span className="tx-day__count">{t('transaction.dateGroupCount', { count: day.count })}</span>
          {day.income > 0 && (
            <span className="amount-income">{formatTotal(day.income, { prefix: '+' })}</span>
          )}
          {(day.expense > 0 || day.income === 0) && (
            <span className="amount-expense">{formatTotal(day.expense, { prefix: '-' })}</span>
          )}
        </div>
      </div>

      <div className="table-wrapper">
        <table>
          {colgroup}
          <tbody>
            {day.rows.map(({ tx, isAlt }) => (
              <TransactionRow
                key={tx.id}
                transaction={tx}
                isAlt={isAlt}
                categoryColors={categoryColors}
                onEdit={onEdit}
                onDelete={onDelete}
                onShowDetail={onShowDetail}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
