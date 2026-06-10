// Long-press action: fires after 500ms of uninterrupted contact on a button.
// Used to instantly clear a symptom chip without cycling through Moderate→Severe.
export function longPress(node: HTMLElement, handler: () => void) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let current = handler;
	let startX = 0;
	let startY = 0;
	// 10px slop: a real finger jitters a few px during a hold — cancelling on any
	// pointermove makes long-press unfireable on an actual touchscreen.
	const SLOP = 10;

	function start(e: PointerEvent) {
		if (e.button !== 0 && e.pointerType === 'mouse') return; // mouse: left only
		startX = e.clientX;
		startY = e.clientY;
		timer = setTimeout(() => {
			timer = undefined;
			// The finger-lift after a fired long-press still dispatches a click,
			// which would immediately re-cycle the chip we just cleared — swallow it.
			// If no click arrives (gesture cancelled by the system), drop the
			// swallower shortly after so it can't eat the next genuine tap.
			const swallow = (ce: Event) => { ce.stopImmediatePropagation(); ce.preventDefault(); };
			node.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 400);
			current();
		}, 500);
	}
	function cancel() {
		clearTimeout(timer);
		timer = undefined;
	}
	function onMove(e: PointerEvent) {
		if (timer === undefined) return;
		if (Math.abs(e.clientX - startX) > SLOP || Math.abs(e.clientY - startY) > SLOP) {
			cancel();
		}
	}

	node.addEventListener('pointerdown', start);
	node.addEventListener('pointerup', cancel);
	node.addEventListener('pointercancel', cancel);
	node.addEventListener('pointermove', onMove);

	return {
		update(next: () => void) { current = next; },
		destroy() {
			node.removeEventListener('pointerdown', start);
			node.removeEventListener('pointerup', cancel);
			node.removeEventListener('pointercancel', cancel);
			node.removeEventListener('pointermove', onMove);
		}
	};
}

// Horizontal swipe action for day/month paging. Deliberately conservative:
// a clear horizontal fling (≥48px, and at least twice the vertical travel)
// so normal vertical scrolling and chip taps never misfire as a swipe.
type SwipeHandlers = {
	onLeft?: () => void; // finger moved left → "next"
	onRight?: () => void; // finger moved right → "previous"
};

export function swipeX(node: HTMLElement, handlers: SwipeHandlers) {
	let startX = 0;
	let startY = 0;
	let tracking = false;
	let current = handlers;

	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 1) return;
		startX = e.touches[0].clientX;
		startY = e.touches[0].clientY;
		tracking = true;
	}

	function onTouchEnd(e: TouchEvent) {
		if (!tracking) return;
		tracking = false;
		const t = e.changedTouches[0];
		const dx = t.clientX - startX;
		const dy = t.clientY - startY;
		if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 2) return;
		if (dx < 0) current.onLeft?.();
		else current.onRight?.();
	}

	node.addEventListener('touchstart', onTouchStart, { passive: true });
	node.addEventListener('touchend', onTouchEnd, { passive: true });

	return {
		update(next: SwipeHandlers) {
			current = next;
		},
		destroy() {
			node.removeEventListener('touchstart', onTouchStart);
			node.removeEventListener('touchend', onTouchEnd);
		}
	};
}
