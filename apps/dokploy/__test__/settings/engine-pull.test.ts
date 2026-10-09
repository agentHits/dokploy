import { Readable } from "node:stream";
import type { EnginePullEvent } from "@dokploy/server/utils/docker/pull-progress";
import { describe, expect, it, vi } from "vitest";

vi.mock("@dokploy/server/constants", () => ({ docker: {} }));

const { pullImageThroughEngine } = await import(
	"@dokploy/server/utils/docker/engine-pull"
);

const IMAGE = "registry.example.com/dokploy:test";

const recorded = (lines: string[]) =>
	lines.map((line) => JSON.parse(line) as EnginePullEvent);

const RECORDED_PULL = recorded([
	'{"status":"Pulling from example/dokploy","id":"test"}',
	'{"status":"Pulling fs layer","progressDetail":{},"id":"4ac6ba6b019e"}',
	'{"status":"Downloading","progressDetail":{"current":10000000,"total":40000000},"progress":"[=====>     ]  10MB/40MB","id":"4ac6ba6b019e"}',
	'{"status":"Download complete","progressDetail":{},"id":"4ac6ba6b019e"}',
	'{"status":"Pull complete","progressDetail":{},"id":"4ac6ba6b019e"}',
	'{"status":"Digest: sha256:0123456789abcdef"}',
	'{"status":"Status: Downloaded newer image for registry.example.com/dokploy:test"}',
]);

const clientReplaying = (
	events: EnginePullEvent[],
	options: { pullError?: Error; streamError?: Error } = {},
) => ({
	pull: vi.fn(async () => {
		if (options.pullError) {
			throw options.pullError;
		}
		return Readable.from([]);
	}),
	modem: {
		followProgress: (
			_stream: NodeJS.ReadableStream,
			onFinished: (error: Error | null, output: EnginePullEvent[]) => void,
			onProgress: (event: EnginePullEvent) => void,
		) => {
			for (const event of events) {
				onProgress(event);
			}
			if (options.streamError) {
				onFinished(options.streamError, []);
				return;
			}
			onFinished(null, events);
		},
	},
});

describe("pullImageThroughEngine", () => {
	it("passes each recorded event on and resolves when the stream ends", async () => {
		const onEvent = vi.fn();
		const client = clientReplaying(RECORDED_PULL);

		await expect(
			pullImageThroughEngine(IMAGE, onEvent, client),
		).resolves.toBeUndefined();

		expect(client.pull).toHaveBeenCalledWith(IMAGE);
		expect(onEvent).toHaveBeenCalledTimes(RECORDED_PULL.length);
		expect(onEvent).toHaveBeenNthCalledWith(3, RECORDED_PULL[2]);
	});

	it("rejects when the stream reports an error event", async () => {
		const events = recorded([
			'{"status":"Pulling fs layer","progressDetail":{},"id":"4ac6ba6b019e"}',
			'{"errorDetail":{"message":"manifest unknown"},"error":"manifest unknown"}',
		]);

		await expect(
			pullImageThroughEngine(IMAGE, vi.fn(), clientReplaying(events)),
		).rejects.toThrow("manifest unknown");
	});

	it("rejects when the pull request itself fails", async () => {
		const client = clientReplaying([], {
			pullError: new Error("no such image"),
		});

		await expect(
			pullImageThroughEngine(IMAGE, vi.fn(), client),
		).rejects.toThrow("no such image");
	});

	it("gives up after 90 seconds without an event and destroys the stream", async () => {
		vi.useFakeTimers();
		try {
			const stream = Readable.from([]);
			const destroy = vi.spyOn(stream, "destroy");
			let reportProgress: (event: EnginePullEvent) => void = () => {};
			const client = {
				pull: vi.fn(async () => stream),
				modem: {
					followProgress: (
						_stream: NodeJS.ReadableStream,
						_onFinished: unknown,
						onProgress: (event: EnginePullEvent) => void,
					) => {
						reportProgress = onProgress;
					},
				},
			};
			const onEvent = vi.fn();
			const outcome = expect(
				pullImageThroughEngine(IMAGE, onEvent, client),
			).rejects.toThrow("no pull progress for 90 seconds");

			await vi.advanceTimersByTimeAsync(60_000);
			reportProgress({ status: "Pulling fs layer" });
			await vi.advanceTimersByTimeAsync(89_999);
			expect(destroy).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);

			await outcome;
			expect(onEvent).toHaveBeenCalledTimes(1);
			expect(destroy).toHaveBeenCalledOnce();
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects when the stream fails", async () => {
		const client = clientReplaying(RECORDED_PULL, {
			streamError: new Error("socket hang up"),
		});

		await expect(
			pullImageThroughEngine(IMAGE, vi.fn(), client),
		).rejects.toThrow("socket hang up");
	});
});
