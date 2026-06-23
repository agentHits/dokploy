import { lookup as lookupHost } from "node:dns/promises";
import { isIP } from "node:net";

export type HostAddress = {
	address: string;
	family: number;
};

export type HostnameLookup = (hostname: string) => Promise<HostAddress[]>;

export const normalizeHostname = (hostname: string) =>
	hostname
		.replace(/^\[|\]$/g, "")
		.replace(/\.$/, "")
		.toLowerCase();

const isBlockedHostname = (hostname: string) => {
	if (!hostname.includes(".")) {
		return true;
	}

	const blockedSuffixes = [
		".corp",
		".home",
		".internal",
		".lan",
		".local",
		".localhost",
	];

	return (
		hostname === "localhost" ||
		blockedSuffixes.some((suffix) => hostname.endsWith(suffix))
	);
};

const parseIPv4Parts = (hostname: string) => {
	const parts = hostname.split(".").map((part) => Number(part));
	if (
		parts.length !== 4 ||
		parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
	) {
		return null;
	}

	return parts;
};

const isBlockedIPv4 = (hostname: string) => {
	const parts = parseIPv4Parts(hostname);
	if (!parts) {
		return false;
	}

	const [first = 0, second = 0, third = 0] = parts;
	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		first >= 224 ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 192 && second === 0 && third === 0) ||
		(first === 192 && second === 0 && third === 2) ||
		(first === 198 && (second === 18 || second === 19)) ||
		(first === 198 && second === 51 && third === 100) ||
		(first === 203 && second === 0 && third === 113)
	);
};

const isBlockedIPv6 = (hostname: string) => {
	const lowerHostname = hostname.toLowerCase();
	const firstHextet = lowerHostname.split(":")[0] ?? "";
	return (
		lowerHostname === "::" ||
		lowerHostname === "::1" ||
		lowerHostname.startsWith("::ffff:") ||
		lowerHostname.startsWith("2001:db8:") ||
		lowerHostname.startsWith("fe80:") ||
		firstHextet.startsWith("fc") ||
		firstHextet.startsWith("fd") ||
		firstHextet.startsWith("ff")
	);
};

export const isBlockedCloudHost = (hostname: string) => {
	const normalizedHostname = normalizeHostname(hostname);
	const ipVersion = isIP(normalizedHostname);
	if (ipVersion === 4) {
		return isBlockedIPv4(normalizedHostname);
	}
	if (ipVersion === 6) {
		return isBlockedIPv6(normalizedHostname);
	}
	return isBlockedHostname(normalizedHostname);
};

const defaultLookup: HostnameLookup = async (hostname) =>
	lookupHost(hostname, { all: true, verbatim: true });

export const assertCloudHostResolvesPublic = async (
	hostname: string,
	options: {
		fieldName?: string;
		lookup?: HostnameLookup;
	} = {},
) => {
	const fieldName = options.fieldName ?? "Host";
	const normalizedHostname = normalizeHostname(hostname);

	if (isBlockedCloudHost(normalizedHostname)) {
		throw new Error(`${fieldName} is not allowed in cloud deployments`);
	}

	if (isIP(normalizedHostname)) {
		return;
	}

	const lookup = options.lookup ?? defaultLookup;
	let addresses: HostAddress[];
	try {
		addresses = await lookup(normalizedHostname);
	} catch {
		throw new Error(`${fieldName} could not be resolved`);
	}

	if (addresses.length === 0) {
		throw new Error(`${fieldName} could not be resolved`);
	}

	if (addresses.some(({ address }) => isBlockedCloudHost(address))) {
		throw new Error(
			`${fieldName} resolves to a host that is not allowed in cloud deployments`,
		);
	}
};
