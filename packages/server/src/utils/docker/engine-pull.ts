import type { Readable } from "node:stream";
import { docker } from "../../constants";
import type { EnginePullEvent } from "./pull-progress";

// Docker reports progress several times a second while it moves bytes, so a
// longer silence means the connection stalled.
const ENGINE_PULL_IDLE_MS = 90_000;

export interface EnginePullClient {
	pull(repoTag: string): Promise<NodeJS.ReadableStream>;
	modem: {
		followProgress(
			stream: NodeJS.ReadableStream,
			onFinished: (error: Error | null, events: EnginePullEvent[]) => void,
			onProgress: (event: EnginePullEvent) => void,
		): void;
	};
}

// The modem reports only stream failures, so an error event inside a
// successful stream would otherwise look like a pull that worked.
const findReportedError = (events: EnginePullEvent[]) => {
	const failure = events.find(
		(event) => event.error !== undefined || event.errorDetail !== undefined,
	);
	if (!failure) {
		return null;
	}
	return new Error(
		failure.error ??
			failure.errorDetail?.message ??
			"Docker could not pull the image.",
	);
};

const destroyStream = (stream: NodeJS.ReadableStream) => {
	(stream as Partial<Readable>).destroy?.();
};

export const pullImageThroughEngine = async (
	image: string,
	onEvent: (event: EnginePullEvent) => void,
	client: EnginePullClient = docker,
) => {
	const stream = await client.pull(image);
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	const events = await new Promise<EnginePullEvent[]>((resolve, reject) => {
		const armIdleTimer = () => {
			clearTimeout(idleTimer);
			idleTimer = setTimeout(() => {
				reject(
					new Error(
						`Docker sent no pull progress for ${ENGINE_PULL_IDLE_MS / 1000} seconds.`,
					),
				);
				destroyStream(stream);
			}, ENGINE_PULL_IDLE_MS);
		};
		armIdleTimer();
		client.modem.followProgress(
			stream,
			(error, output) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(output);
			},
			(event) => {
				armIdleTimer();
				onEvent(event);
			},
		);
	}).finally(() => clearTimeout(idleTimer));
	const reported = findReportedError(events);
	if (reported) {
		throw reported;
	}
};
