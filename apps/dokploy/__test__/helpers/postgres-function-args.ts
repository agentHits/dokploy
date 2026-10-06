import * as schema from "@dokploy/server/db/schema";
import { drizzle } from "drizzle-orm/postgres-js";

export const POSTGRES_MAX_FUNCTION_ARGS = 100;

export const relationalQueryDb = drizzle.mock({ schema });

export const maxJsonBuildArrayArgs = (sqlText: string) => {
	let max = 0;
	for (const match of sqlText.matchAll(/json_build_array\(/g)) {
		let depth = 1;
		let args = 1;
		let quote: string | null = null;
		for (
			let index = match.index + match[0].length;
			index < sqlText.length && depth > 0;
			index++
		) {
			const char = sqlText[index];
			if (quote) {
				if (char === quote) {
					quote = null;
				}
				continue;
			}
			if (char === '"' || char === "'") {
				quote = char;
			} else if (char === "(") {
				depth++;
			} else if (char === ")") {
				depth--;
			} else if (char === "," && depth === 1) {
				args++;
			}
		}
		max = Math.max(max, args);
	}
	return max;
};
