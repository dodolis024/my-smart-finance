import { useLanguage } from '@/contexts/LanguageContext';
import { formatSplitAmount } from '@/lib/splitSettlement';

const syncIcon = (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

/**
 * 「同步到帳本」狀態盒，依同步狀態呈現三態：
 *   未同步 → 說明 + 同步按鈕；有新費用 → 帳本 vs 最新金額 + 更新；已同步 → 金額 + 重新同步
 *
 * @param {object|null} syncStatus  useSplitSync 的同步狀態（null = 尚未同步過）
 * @param {boolean} syncing         同步進行中（按鈕轉圈/禁用）
 * @param {string} currency         群組幣別（金額格式化用）
 * @param {number} fallbackAmount   尚無同步狀態時顯示的預估金額（自己的分攤總額）
 * @param {Function} onSync         按下同步/更新/重新同步
 * @param {Function} onViewDetail   開啟同步明細 modal
 */
export default function SplitSyncBox({ syncStatus, syncing, currency, fallbackAmount, onSync, onViewDetail }) {
  const { t } = useLanguage();
  const fmtAmt = (amt) => formatSplitAmount(amt, currency);

  return (
    <div className="split-sync-box">
      {!syncStatus || !syncStatus.synced ? (
        <div className="split-sync-box__unsync">
          <p className="split-sync-box__desc">
            {t('split.syncDesc', {
              currency: syncStatus?.currency || currency,
              amount: fmtAmt(syncStatus?.current_total ?? fallbackAmount ?? 0),
            })}
          </p>
          <button
            type="button"
            className="split-sync-box__btn split-sync-box__btn--primary"
            onClick={onSync}
            disabled={syncing}
          >
            {syncIcon}
            {syncing ? t('split.syncing') : t('split.syncBtn')}
          </button>
        </div>
      ) : syncStatus.needs_update ? (
        <div className="split-sync-box__needs-update">
          <div className="split-sync-box__update-info">
            <span className="split-sync-box__dot" />
            <span className="split-sync-box__update-text">{t('split.hasNewExpenses')}</span>
          </div>
          <p className="split-sync-box__desc">
            {t('split.ledgerRecord')}{syncStatus.currency} {fmtAmt(syncStatus.synced_amount)}　→　{t('split.latest')}{syncStatus.currency} {fmtAmt(syncStatus.current_total)}
          </p>
          <div className="split-sync-box__actions">
            <button
              type="button"
              className="split-sync-box__btn split-sync-box__btn--primary"
              onClick={onSync}
              disabled={syncing}
            >
              {syncIcon}
              {syncing ? t('split.updating') : t('split.updateSync')}
            </button>
            <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={onViewDetail}>
              {t('split.viewDetail')}
            </button>
          </div>
        </div>
      ) : (
        <div className="split-sync-box__synced">
          <div className="split-sync-box__synced-info">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="split-sync-box__check-icon" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
            </svg>
            <span className="split-sync-box__synced-label">{t('split.synced')}</span>
            <span className="split-sync-box__synced-amount">{syncStatus.currency} {fmtAmt(syncStatus.synced_amount)}</span>
          </div>
          <div className="split-sync-box__actions">
            <button
              type="button"
              className="split-sync-box__btn split-sync-box__btn--secondary"
              onClick={onSync}
              disabled={syncing}
            >
              {syncIcon}
              {syncing ? t('split.updating') : t('split.resync')}
            </button>
            <button type="button" className="split-sync-box__btn split-sync-box__btn--secondary" onClick={onViewDetail}>
              {t('split.viewDetail')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
