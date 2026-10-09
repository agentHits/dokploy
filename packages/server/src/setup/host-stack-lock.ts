let hostStackUpdating = false;

export const isHostStackUpdateRunning = () => hostStackUpdating;

// The check and the set run in one synchronous step, so no other request can
// pass the check while the caller is still awaiting something.
export const acquireHostStackUpdateLock = (): (() => void) | null => {
	if (hostStackUpdating) {
		return null;
	}
	hostStackUpdating = true;
	let held = true;
	return () => {
		if (held) {
			held = false;
			hostStackUpdating = false;
		}
	};
};
