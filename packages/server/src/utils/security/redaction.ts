export const REDACTED_SECRET_VALUE = "__DOKPLOY_REDACTED_SECRET__";

type SecretRecord = Record<string, unknown>;

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
