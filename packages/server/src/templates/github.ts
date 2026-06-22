import { isIP } from "node:net";
import { parse } from "toml";

const DEFAULT_TEMPLATES_BASE_URL = "https://templates.dokploy.com";

const isPrivateIPv4 = (hostname: string) => {
	const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
	const first = parts[0] ?? -1;
	const second = parts[1] ?? -1;

	return (
		first === 0 ||
		first === 10 ||
		first === 127 ||
		(first === 169 && second === 254) ||
		(first === 172 && second >= 16 && second <= 31) ||
		(first === 192 && second === 168) ||
		(first === 100 && second >= 64 && second <= 127) ||
		(first === 192 && second === 0) ||
		(first === 198 && (second === 18 || second === 19)) ||
		first >= 224
	);
};

const isPrivateIPv6 = (hostname: string) => {
	const normalized = hostname
		.toLowerCase()
		.replace(/^\[/, "")
		.replace(/\]$/, "");

	if (normalized === "::" || normalized === "::1") {
		return true;
	}

	if (normalized.startsWith("::ffff:")) {
		const mappedIPv4 = normalized.replace("::ffff:", "");
		return isIP(mappedIPv4) === 4 ? isPrivateIPv4(mappedIPv4) : true;
	}

	const firstSegment = normalized.split(":")[0];
	const firstSegmentNumber = Number.parseInt(firstSegment || "0", 16);

	return (
		(firstSegmentNumber & 0xfe00) === 0xfc00 ||
		(firstSegmentNumber & 0xffc0) === 0xfe80 ||
		(firstSegmentNumber & 0xff00) === 0xff00
	);
};

const isUnsafeHost = (hostname: string) => {
	const normalized = hostname
		.toLowerCase()
		.replace(/^\[/, "")
		.replace(/\]$/, "")
		.replace(/\.$/, "");
	const ipVersion = isIP(normalized);

	if (ipVersion === 4) {
		return isPrivateIPv4(normalized);
	}

	if (ipVersion === 6) {
		return isPrivateIPv6(normalized);
	}

	return (
		normalized === "localhost" ||
		normalized.endsWith(".localhost") ||
		!normalized.includes(".")
	);
};

const resolveTemplatesBaseUrl = (baseUrl?: string) => {
	if (!baseUrl) {
		return DEFAULT_TEMPLATES_BASE_URL;
	}

	let parsed: URL;
	try {
		parsed = new URL(baseUrl);
	} catch {
		throw new Error("Invalid template base URL");
	}

	if (
		parsed.protocol !== "https:" ||
		parsed.username ||
		parsed.password ||
		(parsed.pathname !== "" && parsed.pathname !== "/") ||
		parsed.search ||
		parsed.hash ||
		isUnsafeHost(parsed.hostname)
	) {
		throw new Error("Invalid template base URL");
	}

	return parsed.origin;
};

const buildTemplateUrl = (baseUrl: string | undefined, pathname: string) => {
	return new URL(pathname, resolveTemplatesBaseUrl(baseUrl)).toString();
};

/**
 * Complete template interface that includes both metadata and configuration
 */
export interface CompleteTemplate {
	metadata: {
		id: string;
		name: string;
		description: string;
		tags: string[];
		version: string;
		logo: string;
		links: {
			github: string;
			website?: string;
			docs?: string;
		};
	};
	variables: {
		[key: string]: string;
	};
	config: {
		isolated?: boolean;
		domains: Array<{
			serviceName: string;
			port: number;
			path?: string;
			host?: string;
		}>;
		env: Record<string, string>;
		mounts?: Array<{
			filePath: string;
			content: string;
		}>;
	};
}

interface TemplateMetadata {
	id: string;
	name: string;
	description: string;
	version: string;
	logo: string;
	links: {
		github: string;
		website?: string;
		docs?: string;
	};
	tags: string[];
}

/**
 * Fetches the list of available templates from meta.json
 */
export async function fetchTemplatesList(
	baseUrl?: string,
): Promise<TemplateMetadata[]> {
	const response = await fetch(buildTemplateUrl(baseUrl, "/meta.json"), {
		redirect: "error",
		signal: AbortSignal.timeout(10000),
	});
	if (!response.ok) {
		throw new Error(`Failed to fetch templates: ${response.statusText}`);
	}
	const templates = (await response.json()) as TemplateMetadata[];
	return templates.map((template) => ({
		id: template.id,
		name: template.name,
		description: template.description,
		version: template.version,
		logo: template.logo,
		links: template.links,
		tags: template.tags,
	}));
}

/**
 * Fetches a specific template's files
 */
export async function fetchTemplateFiles(
	templateId: string,
	baseUrl?: string,
): Promise<{ config: CompleteTemplate; dockerCompose: string }> {
	const timeout = AbortSignal.timeout(10000);
	const [templateYmlResponse, dockerComposeResponse] = await Promise.all([
		fetch(
			buildTemplateUrl(baseUrl, `/blueprints/${templateId}/template.toml`),
			{
				redirect: "error",
				signal: timeout,
			},
		),
		fetch(
			buildTemplateUrl(baseUrl, `/blueprints/${templateId}/docker-compose.yml`),
			{
				redirect: "error",
				signal: timeout,
			},
		),
	]);

	if (!templateYmlResponse.ok || !dockerComposeResponse.ok) {
		throw new Error("Template files not found");
	}

	const [templateYml, dockerCompose] = await Promise.all([
		templateYmlResponse.text(),
		dockerComposeResponse.text(),
	]);

	const config = parse(templateYml) as CompleteTemplate;

	return { config, dockerCompose };
}
