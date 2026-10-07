import type { IncomingMessage } from "node:http";

const firstHeader = (req: IncomingMessage | undefined, name: string) => {
	const value = req?.headers?.[name];
	return (Array.isArray(value) ? value[0] : value)?.trim() || null;
};

export const getRequestMeta = (req: IncomingMessage | undefined) => ({
	ipAddress:
		firstHeader(req, "x-real-ip") ??
		firstHeader(req, "x-forwarded-for")?.split(",")[0]?.trim() ??
		req?.socket?.remoteAddress ??
		null,
	userAgent: firstHeader(req, "user-agent"),
});
