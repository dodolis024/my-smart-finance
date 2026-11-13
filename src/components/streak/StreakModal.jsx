import Modal from '@/components/common/Modal';
import StreakCalendar from './StreakCalendar';
import { useLanguage } from '@/contexts/LanguageContext';

export default function StreakModal({ isOpen, onClose, streakState, freezeState, title, variant = 'neutral' }) {
  const { t } = useLanguage();
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="reaction-modal" titleId={title ? 'streak-modal-title' : undefined} closeLabel={t('common.close')}>
      <div className="reaction-modal__backdrop" onClick={onClose} />
      <div className="reaction-modal__dialog" data-modal-card data-variant={variant}>
        {title && <h2 id="streak-modal-title" className="reaction-modal__title">{title}</h2>}
        <StreakCalendar streakState={streakState} freezeState={freezeState} />
      </div>
    </Modal>
  );
}
