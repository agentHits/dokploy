export const REDACTED_SECRET_VALUE = "__DOKPLOY_REDACTED_SECRET__";

type SecretRecord = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN =
	"(?:access[_-]?key|api[_-]?key|authorization|credential|private[_-]?key|refresh[_-]?token|secret|token|password|passwd|pwd)";

export const isRedactedSecretValue = (value: unknown) =>
	value === REDACTED_SECRET_VALUE;

export const redactSecretValue = <T>(value: T) => {
	if (value === null || value === undefined || value === "") {
		return value;
	}

	return REDACTED_SECRET_VALUE;
};

export const redactSecretFields = <T extends SecretRecord | null | undefined>(
	record: T,
	fields: string[],
) => {
	if (!record) {
		return record;
	}

	const redacted = { ...record };

	for (const field of fields) {
		if (field in redacted) {
			redacted[field] = redactSecretValue(redacted[field]);
		}
	}

	return redacted as T;
};

export const redactSecretFieldsList = <T extends SecretRecord>(
	records: T[],
	fields: string[],
) => records.map((record) => redactSecretFields(record, fields));

export const redactDeployableServiceSecrets = <
	T extends SecretRecord | null | undefined,
>(
	record: T,
) =>
	redactSecretFields(record, [
		"env",
		"previewEnv",
		"buildArgs",
		"buildSecrets",
		"previewBuildArgs",
		"previewBuildSecrets",
		"password",
		"refreshToken",
	]);

export const redactDatabaseServiceSecrets = <
	T extends SecretRecord | null | undefined,
>(
	record: T,
) =>
	redactSecretFields(record, [
		"env",
		"databasePassword",
		"databaseRootPassword",
	]);

export function redactSensitiveText(value: string): string;
export function redactSensitiveText(value: null): null;
export function redactSensitiveText(value: undefined): undefined;
export function redactSensitiveText(value: string | null): string | null;
export function redactSensitiveText(
	value: string | undefined,
): string | undefined;
export function redactSensitiveText(
	value: string | null | undefined,
): string | null | undefined;
export function redactSensitiveText(value: string | null | undefined) {
	if (typeof value !== "string" || value === "") {
		return value;
	}

	let redacted = value;

	redacted = redacted.replace(
		/(\b[a-z][a-z0-9+.-]*:\/\/)([^@\s/?#]+)@/gi,
		`$1${REDACTED_SECRET_VALUE}@`,
	);

	redacted = redacted.replace(
		new RegExp(
			`([?&#][^=\\s]*${SENSITIVE_KEY_PATTERN}[^=\\s]*=)([^&#\\s]+)`,
			"gi",
		),
		`$1${REDACTED_SECRET_VALUE}`,
	);

	redacted = redacted.replace(
		new RegExp(
			`(\\b[A-Z0-9_]*${SENSITIVE_KEY_PATTERN}[A-Z0-9_]*=)("[^"]*"|'[^']*'|[^\\s;&|]+)`,
			"gi",
		),
		`$1${REDACTED_SECRET_VALUE}`,
	);

	redacted = redacted.replace(
		new RegExp(
			`(\\s--?[a-z0-9-]*${SENSITIVE_KEY_PATTERN}[a-z0-9-]*(?:=|\\s+))("[^"]*"|'[^']*'|[^\\s;&|]+)`,
			"gi",
		),
		`$1${REDACTED_SECRET_VALUE}`,
	);

	redacted = redacted.replace(
		/(\bmongo(?:dump|export|import|restore|sh)?\b[^\n;&|]*?\s-p\s+)[^\n;&|]+/gi,
		`$1${REDACTED_SECRET_VALUE}`,
	);

	redacted = redacted.replace(
		/(\b(?:postgres(?:ql)?|mysql|mariadb|mongodb|redis):\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi,
		`$1${REDACTED_SECRET_VALUE}$3`,
	);

	redacted = redacted.replace(
		/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi,
		`$1 ${REDACTED_SECRET_VALUE}`,
	);

	redacted = redacted.replace(
		/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
		REDACTED_SECRET_VALUE,
	);

	return redacted;
}

export const secretUpdateValue = (value: unknown) => {
	if (
		typeof value !== "string" ||
		value.trim() === "" ||
		isRedactedSecretValue(value)
	) {
		return undefined;
	}

	return value;
};
