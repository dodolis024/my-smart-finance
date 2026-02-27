import Modal from '@/components/common/Modal';
import StreakCalendar from './StreakCalendar';

export default function StreakModal({ isOpen, onClose, streakState, title, variant = 'neutral' }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} className="reaction-modal">
      <div className="reaction-modal__backdrop" onClick={onClose} />
      <div className="reaction-modal__dialog" data-variant={variant}>
        <button type="button" className="reaction-modal__close" aria-label="關閉" onClick={onClose}>×</button>
        {title && <h2 className="reaction-modal__title">{title}</h2>}
        <StreakCalendar streakState={streakState} />
      </div>
    </Modal>
  );
}
