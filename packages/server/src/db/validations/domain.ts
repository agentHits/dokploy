import { z } from "zod";

const TRAEFIK_RULE_UNSAFE_HOST_CHARS = /[\s`"'(){}[\]|&!;,:/\\]/;
const TRAEFIK_RULE_UNSAFE_PATH_CHARS = /[\s`"'(){}[\]|&!;\\]/;
const HOST_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const isValidTraefikHost = (host: string) => {
	if (host !== host.trim() || TRAEFIK_RULE_UNSAFE_HOST_CHARS.test(host)) {
		return false;
	}

	const isWildcard = host.startsWith("*.");
	const hostToParse = isWildcard ? host.slice(2) : host;
	if (!hostToParse || hostToParse.includes("*")) {
		return false;
	}

	try {
		const asciiHost = new URL(`http://${hostToParse}`).hostname;
		if (!asciiHost || asciiHost.length > 253 || asciiHost.endsWith(".")) {
			return false;
		}

		if (asciiHost === "localhost") {
			return true;
		}

		return asciiHost.split(".").every((label) => HOST_LABEL_REGEX.test(label));
	} catch {
		return false;
	}
};

const isValidTraefikPath = (path: string | null | undefined) => {
	if (path === null || path === undefined) {
		return true;
	}

	return (
		path.startsWith("/") &&
		path === path.trim() &&
		!TRAEFIK_RULE_UNSAFE_PATH_CHARS.test(path)
	);
};

const hostSchema = z
	.string()
	.min(1, { message: "Add a hostname" })
	.refine((val) => val === val.trim(), {
		message: "Domain name cannot have leading or trailing spaces",
	})
	.refine(isValidTraefikHost, {
		message: "Invalid hostname",
	})
	.transform((val) => val.trim());

const pathSchema = z
	.string()
	.min(1)
	.refine(isValidTraefikPath, {
		message: "Path must start with '/' and cannot contain Traefik rule syntax",
	})
	.nullable()
	.optional();

export const domain = z
	.object({
		host: hostSchema,
		path: pathSchema,
		internalPath: pathSchema,
		stripPath: z.boolean().optional(),
		port: z
			.number()
			.min(1, { message: "Port must be at least 1" })
			.max(65535, { message: "Port must be 65535 or below" })
			.nullable()
			.optional(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
		customCertResolver: z.string().nullable().optional(),
		middlewares: z.array(z.string()).nullable().optional(),
	})
	.superRefine((input, ctx) => {
		if (input.https && !input.certificateType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["certificateType"],
				message: "Required",
			});
		}

		if (input.certificateType === "custom" && !input.customCertResolver) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customCertResolver"],
				message: "Required when certificate type is custom",
			});
		}

		// Validate stripPath requires a valid path
		if (input.stripPath && (!input.path || input.path === "/")) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stripPath"],
				message:
					"Strip path can only be enabled when a path other than '/' is specified",
			});
		}
	});

export const domainCompose = z
	.object({
		host: hostSchema,
		path: pathSchema,
		internalPath: pathSchema,
		stripPath: z.boolean().optional(),
		port: z
			.number()
			.min(1, { message: "Port must be at least 1" })
			.max(65535, { message: "Port must be 65535 or below" })
			.nullable()
			.optional(),
		https: z.boolean().optional(),
		certificateType: z.enum(["letsencrypt", "none", "custom"]).optional(),
		customCertResolver: z.string().nullable().optional(),
		serviceName: z.string().min(1, { message: "Service name is required" }),
		middlewares: z.array(z.string()).nullable().optional(),
	})
	.superRefine((input, ctx) => {
		if (input.https && !input.certificateType) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["certificateType"],
				message: "Required",
			});
		}

		if (input.certificateType === "custom" && !input.customCertResolver) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["customCertResolver"],
				message: "Required when certificate type is custom",
			});
		}

		// Validate stripPath requires a valid path
		if (input.stripPath && (!input.path || input.path === "/")) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["stripPath"],
				message:
					"Strip path can only be enabled when a path other than '/' is specified",
			});
		}
	});
