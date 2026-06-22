import path from "node:path";
import { quote } from "shell-quote";

const UNSAFE_RELATIVE_PATH_PATTERN = /[`$;&|<>"']/;

const isWindowsAbsolutePath = (filePath: string) =>
	/^[A-Za-z]:[\\/]/.test(filePath);

const hasReservedGitDirectorySegment = (filePath: string) =>
	filePath.split("/").includes(".git");

export const normalizeRelativeFilePath = (filePath: string) => {
	if (typeof filePath !== "string") {
		throw new Error("Invalid file path");
	}

	if (filePath.includes("\0") || /[\r\n\t]/.test(filePath)) {
		throw new Error("Invalid file path");
	}

	if (isWindowsAbsolutePath(filePath) || filePath.startsWith("\\\\")) {
		throw new Error("Invalid file path");
	}

	const normalizedSeparators = filePath.trim().replace(/\\/g, "/");
	if (
		!normalizedSeparators ||
		UNSAFE_RELATIVE_PATH_PATTERN.test(normalizedSeparators)
	) {
		throw new Error("Invalid file path");
	}

	const withoutLeadingSlashes = normalizedSeparators.replace(/^\/+/, "");
	const normalized = path.posix.normalize(withoutLeadingSlashes);

	if (
		!normalized ||
		normalized === "." ||
		normalized === ".." ||
		normalized.startsWith("../") ||
		hasReservedGitDirectorySegment(normalized) ||
		path.posix.isAbsolute(normalized)
	) {
		throw new Error("Invalid file path");
	}

	return normalized;
};

export const resolveFilePathInsideDirectory = (
	basePath: string,
	filePath: string,
) => {
	const relativePath = normalizeRelativeFilePath(filePath);
	const absoluteBasePath = path.resolve(basePath);
	const fullPath = path.resolve(absoluteBasePath, relativePath);

	if (
		fullPath !== absoluteBasePath &&
		!fullPath.startsWith(`${absoluteBasePath}${path.sep}`)
	) {
		throw new Error("Invalid file path");
	}

	return {
		fullPath,
		isDirectory: filePath.trim().replace(/\\/g, "/").endsWith("/"),
		relativePath,
	};
};

export const quoteShellArg = (value: string) => quote([value]);
