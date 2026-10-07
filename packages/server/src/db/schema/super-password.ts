import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";
import { user } from "./user";

export const superPassword = pgTable("super_password", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	passwordHash: text("password_hash").notNull(),
	hint: text("hint"),
	failedAttempts: integer("failed_attempts").notNull().default(0),
	lockedUntil: timestamp("locked_until"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const superSession = pgTable("super_session", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	expiresAt: timestamp("expires_at").notNull(),
	openedAt: timestamp("opened_at").notNull(),
	openedBySessionId: text("opened_by_session_id"),
	lastExtendedAt: timestamp("last_extended_at"),
});

export type SuperPasswordTokenType = "reset" | "lock";

export const superPasswordToken = pgTable(
	"super_password_token",
	{
		id: text("id")
			.primaryKey()
			.$defaultFn(() => nanoid()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		type: text("type").$type<SuperPasswordTokenType>().notNull(),
		tokenHash: text("token_hash").notNull().unique(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [index("super_password_token_user_id_idx").on(table.userId)],
);
