import pino from "pino";
import pretty from "pino-pretty";

// A pino `transport` starts a worker thread per logger, and this module is
// evaluated once per server bundle, so the panel kept several idle threads of
// ~20 MB each. Formatting in the main thread gives the same output.
export const logger = pino(
	pretty({
		colorize: true,
		levelFirst: false,
	}),
);
