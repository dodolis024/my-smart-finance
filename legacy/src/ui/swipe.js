/**
 * Smart Expense Tracker - 手機滑動操作
 */

let currentOpenSwipeContainer = null;

function resetSwipeContainer(container) {
    if (!container) return;
    const content = container.querySelector('.swipe-content');
    if (content) {
        content.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        content.style.transform = 'translateX(0)';
    }
    container.classList.remove('swiped-left', 'swiped-right');
    container._swipeState = { currentTranslate: 0, prevTranslate: 0 };
    if (currentOpenSwipeContainer === container) {
        currentOpenSwipeContainer = null;
    }
}

function initSwipe(container) {
    if (!container) return;

    const content = container.querySelector('.swipe-content');
    if (!content) return;

    container._swipeState = { currentTranslate: 0, prevTranslate: 0 };

    let startX = 0;
    let currentX = 0;
    let isDragging = false;

    function setTranslateX(x) {
        content.style.transform = `translateX(${x}px)`;
        container._swipeState.currentTranslate = x;
    }

    function resetSwipe() {
        container._swipeState.currentTranslate = 0;
        container._swipeState.prevTranslate = 0;
        content.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        setTranslateX(0);
        container.classList.remove('swiped-left', 'swiped-right');
        if (currentOpenSwipeContainer === container) {
            currentOpenSwipeContainer = null;
        }
    }

    function handleStart(e) {
        if (e.target.closest('.btn-edit, .btn-delete, .swipe-action-btn')) return;

        if (currentOpenSwipeContainer && currentOpenSwipeContainer !== container) {
            resetSwipeContainer(currentOpenSwipeContainer);
        }

        const touch = e.touches ? e.touches[0] : e;
        startX = touch.clientX;
        isDragging = true;
        content.style.transition = 'none';

        container._swipeState.prevTranslate = container._swipeState.currentTranslate;
    }

    function handleMove(e) {
        if (!isDragging) return;
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        currentX = touch.clientX - startX;
        const newTranslate = container._swipeState.prevTranslate + currentX;

        const limitedTranslate = Math.max(SWIPE.MAX_LEFT, Math.min(SWIPE.MAX_RIGHT, newTranslate));

        setTranslateX(limitedTranslate);
    }

    function handleEnd() {
        if (!isDragging) return;
        isDragging = false;

        content.style.transition = `transform ${TIMING.SWIPE_TRANSITION_DURATION}ms cubic-bezier(0.4, 0, 0.2, 1)`;

        const currentTranslate = container._swipeState.currentTranslate;

        if (currentTranslate < -SWIPE.THRESHOLD) {
            container._swipeState.currentTranslate = -SWIPE.ACTION_WIDTH;
            container._swipeState.prevTranslate = -SWIPE.ACTION_WIDTH;
            setTranslateX(-SWIPE.ACTION_WIDTH);
            container.classList.add('swiped-left');
            container.classList.remove('swiped-right');
            currentOpenSwipeContainer = container;
        } else if (currentTranslate > SWIPE.THRESHOLD) {
            container._swipeState.currentTranslate = SWIPE.ACTION_WIDTH;
            container._swipeState.prevTranslate = SWIPE.ACTION_WIDTH;
            setTranslateX(SWIPE.ACTION_WIDTH);
            container.classList.add('swiped-right');
            container.classList.remove('swiped-left');
            currentOpenSwipeContainer = container;
        } else {
            resetSwipe();
        }
    }

    content.addEventListener('touchstart', handleStart, { passive: false });
    content.addEventListener('touchmove', handleMove, { passive: false });
    content.addEventListener('touchend', handleEnd, { passive: true });

    content.addEventListener('click', (e) => {
        if (container.classList.contains('swiped-left') || container.classList.contains('swiped-right')) {
            if (e.target.closest('.btn-edit, .btn-delete')) return;
            e.preventDefault();
            resetSwipe();
        }
    });
}
