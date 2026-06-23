import { quoteShellArg } from "@dokploy/server";
import {
	DATABASE_IDENTIFIER_MESSAGE,
	DATABASE_IDENTIFIER_REGEX,
} from "@dokploy/server/db/schema";
import { TRPCError } from "@trpc/server";

const quoteSqlLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const quotePostgresIdentifier = (value: string) =>
	`"${value.replace(/"/g, '""')}"`;

const assertSafeDatabaseIdentifier = (value: string) => {
	if (!DATABASE_IDENTIFIER_REGEX.test(value)) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: DATABASE_IDENTIFIER_MESSAGE,
		});
	}
	return value;
};

export const buildPostgresPasswordChangeCommand = ({
	databaseUser,
	password,
}: {
	databaseUser: string;
	password: string;
}) => {
	const safeDatabaseUser = assertSafeDatabaseIdentifier(databaseUser);
	const sql = `ALTER USER ${quotePostgresIdentifier(safeDatabaseUser)} WITH PASSWORD ${quoteSqlLiteral(password)};`;
	return `docker exec "$CONTAINER_ID" psql -U ${quoteShellArg(safeDatabaseUser)} -c ${quoteShellArg(sql)}`;
};

export const buildMysqlPasswordChangeCommand = ({
	client,
	databaseRootPassword,
	targetUser,
	password,
}: {
	client: "mariadb" | "mysql";
	databaseRootPassword: string;
	targetUser: string;
	password: string;
}) => {
	const safeTargetUser = assertSafeDatabaseIdentifier(targetUser);
	const sql = `ALTER USER ${quoteSqlLiteral(safeTargetUser)}@'%' IDENTIFIED BY ${quoteSqlLiteral(password)}; FLUSH PRIVILEGES;`;
	return `docker exec "$CONTAINER_ID" ${client} -u root ${quoteShellArg(`-p${databaseRootPassword}`)} -e ${quoteShellArg(sql)}`;
};
