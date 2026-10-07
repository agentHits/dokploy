import type { IncomingMessage } from "node:http";
import { resolveTrustedOriginsForAuthRequest } from "@dokploy/server";

const parseHttpOrigin = (value: string) => {
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? url : null;
	} catch {
		return null;
	}
};

// Host carries no scheme and the panel often sits behind a TLS-terminating
// proxy, so Host is parsed with the origin's own scheme: this compares
// host:port only and still normalizes default ports (":443" vs none).
const matchesRequestHost = (origin: URL, host: string | undefined) => {
	if (!host) return false;
	try {
		return new URL(`${origin.protocol}//${host}`).host === origin.host;
	} catch {
		return false;
	}
};

export const isWebSocketOriginAllowed = async (
	origin: string | undefined,
	host: string | undefined,
) => {
	// Browsers always send Origin on WebSocket handshakes, so only non-browser
	// clients (x-api-key scripts, CLI tools) omit it, and those cannot ride a
	// browser's ambient session cookie.
	if (origin === undefined) return true;

	const originUrl = parseHttpOrigin(origin);
	if (!originUrl) return false;
	if (matchesRequestHost(originUrl, host)) return true;

	const trustedOrigins = await resolveTrustedOriginsForAuthRequest();
	return trustedOrigins.some(
		(trusted) => parseHttpOrigin(trusted)?.origin === originUrl.origin,
	);
};

// Runs inside ws.handleUpgrade, before the "connection" event, so a rejected
// cross-site handshake gets a 403 without any session lookup.
export const verifyWebSocketOrigin = (
	info: { origin?: string; req: IncomingMessage },
	callback: (verified: boolean, code?: number) => void,
) => {
	isWebSocketOriginAllowed(info.origin, info.req.headers.host).then(
		(allowed) => (allowed ? callback(true) : callback(false, 403)),
		() => callback(false, 403),
	);
};
