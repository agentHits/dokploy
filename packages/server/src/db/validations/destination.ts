export const ADDITIONAL_FLAG_REGEX = /^--[a-zA-Z0-9-]+(=[a-zA-Z0-9._:/@-]+)?$/;
export const ADDITIONAL_FLAG_ERROR =
	"Invalid flag format. Must start with -- (e.g. --s3-sign-accept-encoding=false)";

const PROTECTED_RCLONE_ADDITIONAL_FLAGS = new Set([
	"--ask-password",
	"--config",
	"--password-command",
	"--s3-access-key-id",
	"--s3-endpoint",
	"--s3-env-auth",
	"--s3-force-path-style",
	"--s3-no-check-bucket",
	"--s3-profile",
	"--s3-provider",
	"--s3-region",
	"--s3-secret-access-key",
	"--s3-session-token",
]);

const ALLOWED_RCLONE_S3_ADDITIONAL_FLAGS = new Set([
	"--s3-sign-accept-encoding",
]);

export const RCLONE_ADDITIONAL_FLAG_ERROR =
	"Additional flags cannot override rclone config, S3 endpoint, provider, region, credentials, or path-style settings";

export const getAdditionalFlagName = (flag: string) =>
	flag.split("=", 1)[0]?.toLowerCase() || "";

export const isRcloneAdditionalFlagAllowed = (flag: string) =>
	ADDITIONAL_FLAG_REGEX.test(flag) &&
	!PROTECTED_RCLONE_ADDITIONAL_FLAGS.has(getAdditionalFlagName(flag)) &&
	(!getAdditionalFlagName(flag).startsWith("--s3-") ||
		ALLOWED_RCLONE_S3_ADDITIONAL_FLAGS.has(getAdditionalFlagName(flag)));

export const assertRcloneAdditionalFlagsAllowed = (
	flags?: readonly string[] | null,
) => {
	for (const flag of flags || []) {
		if (!isRcloneAdditionalFlagAllowed(flag)) {
			throw new Error(RCLONE_ADDITIONAL_FLAG_ERROR);
		}
	}
};
