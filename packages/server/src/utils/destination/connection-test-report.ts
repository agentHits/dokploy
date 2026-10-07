export const DESTINATION_ACCESS_CHECKS = ["read", "write", "delete"] as const;

export type DestinationAccessCheckName =
	(typeof DESTINATION_ACCESS_CHECKS)[number];

export type DestinationAccessCheckResult = {
	ok: boolean;
	skipped?: boolean;
	reason?: string;
};

export type DestinationConnectionTestReport = Record<
	DestinationAccessCheckName,
	DestinationAccessCheckResult
>;

export const DESTINATION_ACCESS_CHECK_LABELS: Record<
	DestinationAccessCheckName,
	string
> = {
	read: "Read",
	write: "Write",
	delete: "Delete",
};

const REPORT_LINE_PATTERN =
	/^(Read|Write|Delete): (OK|FAILED|SKIPPED)(?: - (.+))?$/;

export const isDestinationConnectionTestPassed = (
	report: DestinationConnectionTestReport,
) => DESTINATION_ACCESS_CHECKS.every((name) => report[name].ok);

// The UI parses this text back with parseDestinationConnectionTestReport, so
// a failed test can stay a plain tRPC error for API and MCP clients.
export const formatDestinationConnectionTestReport = (
	report: DestinationConnectionTestReport,
) =>
	DESTINATION_ACCESS_CHECKS.map((name) => {
		const check = report[name];
		const label = DESTINATION_ACCESS_CHECK_LABELS[name];
		if (check.ok) {
			return `${label}: OK`;
		}
		const status = check.skipped ? "SKIPPED" : "FAILED";
		return check.reason
			? `${label}: ${status} - ${check.reason}`
			: `${label}: ${status}`;
	}).join("\n");

export const parseDestinationConnectionTestReport = (
	message: string,
): DestinationConnectionTestReport | null => {
	const report: Partial<DestinationConnectionTestReport> = {};
	for (const line of message.split("\n")) {
		const match = REPORT_LINE_PATTERN.exec(line.trim());
		if (!match) {
			continue;
		}
		const [, label, status, reason] = match;
		const name = DESTINATION_ACCESS_CHECKS.find(
			(check) => DESTINATION_ACCESS_CHECK_LABELS[check] === label,
		);
		if (!name) {
			continue;
		}
		report[name] = {
			ok: status === "OK",
			...(status === "SKIPPED" ? { skipped: true } : {}),
			...(reason ? { reason } : {}),
		};
	}

	const { read, write, delete: deleteCheck } = report;
	return read && write && deleteCheck
		? { read, write, delete: deleteCheck }
		: null;
};
