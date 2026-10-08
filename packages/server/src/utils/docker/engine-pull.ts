import { docker } from "../../constants";
import type { EnginePullEvent } from "./pull-progress";

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

export const pullImageThroughEngine = async (
	image: string,
	onEvent: (event: EnginePullEvent) => void,
	client: EnginePullClient = docker,
) => {
	const stream = await client.pull(image);
	const events = await new Promise<EnginePullEvent[]>((resolve, reject) => {
		client.modem.followProgress(
			stream,
			(error, output) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(output);
			},
			onEvent,
		);
	});
	const reported = findReportedError(events);
	if (reported) {
		throw reported;
	}
};
