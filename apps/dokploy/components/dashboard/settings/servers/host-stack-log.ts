export const UPDATE_DONE = "Components update finished ✅";
export const UPDATE_FAILED = "Components update failed ❌";

// A chunk can end in the middle of a marker, so the outcome is read from the
// whole log. Only the chunk that completes a marker reports it, so a marker
// that is already in the log is not reported again.
export const updateOutcome = (
	previousLog: string,
	log: string,
): "done" | "failed" | null => {
	const completes = (marker: string) =>
		!previousLog.includes(marker) && log.includes(marker);
	if (completes(UPDATE_DONE)) {
		return "done";
	}
	if (completes(UPDATE_FAILED)) {
		return "failed";
	}
	return null;
};
