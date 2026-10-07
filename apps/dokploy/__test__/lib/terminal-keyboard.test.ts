import type { Terminal } from "@xterm/xterm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { attachTerminalKeyHandlers } from "@/lib/terminal-keyboard";

const setup = (platform: string) => {
	vi.stubGlobal("navigator", { platform });
	let handler: ((event: KeyboardEvent) => boolean) | undefined;
	const input = vi.fn();
	const term = {
		attachCustomKeyEventHandler: (fn: (event: KeyboardEvent) => boolean) => {
			handler = fn;
		},
		input,
	} as unknown as Terminal;
	attachTerminalKeyHandlers(term);
	const press = (
		key: string,
		modifiers: Partial<
			Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey">
		> = {},
		type = "keydown",
	) => {
		const preventDefault = vi.fn();
		const result = handler?.({
			type,
			key,
			altKey: false,
			ctrlKey: false,
			metaKey: false,
			shiftKey: false,
			...modifiers,
			preventDefault,
		} as unknown as KeyboardEvent);
		return { result, preventDefault };
	};
	return { press, input };
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("attachTerminalKeyHandlers", () => {
	it.each([
		["ArrowUp", "\x1b[1;5A"],
		["ArrowDown", "\x1b[1;5B"],
		["ArrowRight", "\x1b[1;5C"],
		["ArrowLeft", "\x1b[1;5D"],
	])("sends Ctrl+%s for Alt+%s on every platform", (key, sequence) => {
		for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
			const { press, input } = setup(platform);
			const { result, preventDefault } = press(key, { altKey: true });
			expect(result).toBe(false);
			expect(preventDefault).toHaveBeenCalled();
			expect(input).toHaveBeenCalledWith(sequence);
		}
	});

	it.each([{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }])(
		"leaves Alt+Arrow with %o to xterm",
		(extra) => {
			const { press, input } = setup("Linux x86_64");
			expect(press("ArrowLeft", { altKey: true, ...extra }).result).toBe(true);
			expect(input).not.toHaveBeenCalled();
		},
	);

	it("leaves plain arrows and keyup events to xterm", () => {
		const { press, input } = setup("MacIntel");
		expect(press("ArrowLeft").result).toBe(true);
		expect(press("ArrowLeft", { altKey: true }, "keyup").result).toBe(true);
		expect(input).not.toHaveBeenCalled();
	});

	it("types Option-composed characters on macOS", () => {
		const { press, input } = setup("MacIntel");
		const { result, preventDefault } = press("@", { altKey: true });
		expect(result).toBe(false);
		expect(preventDefault).toHaveBeenCalled();
		expect(input).toHaveBeenCalledWith("@");
	});

	it("keeps Alt+letter for xterm outside macOS", () => {
		const { press, input } = setup("Win32");
		expect(press("l", { altKey: true }).result).toBe(true);
		expect(input).not.toHaveBeenCalled();
	});
});
