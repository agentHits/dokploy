import type { Terminal } from "@xterm/xterm";

const ALT_ARROW_AS_CTRL_ARROW: Record<string, string> = {
	ArrowUp: "\x1b[1;5A",
	ArrowDown: "\x1b[1;5B",
	ArrowRight: "\x1b[1;5C",
	ArrowLeft: "\x1b[1;5D",
};

// xterm's platform detection mistakes the bundled Next.js `process` polyfill
// for Node.js, so it never treats Option/Alt as third-level shift on macOS and
// swallows composed characters like Option+L (@ on German layouts).
// https://github.com/Dokploy/dokploy/issues/4297
//
// xterm 6 also dropped its Alt+Arrow -> Ctrl+Arrow rewrite (xtermjs/xterm.js#5346),
// which shells bind to word jumps. Because of the same detection bug, xterm 5
// always took its non-macOS branch here, so these are the sequences it sent.
// xterm keeps a single custom key handler, so both fixes share it.
export const attachTerminalKeyHandlers = (term: Terminal) => {
	const isMac = /Mac/.test(navigator.platform);
	term.attachCustomKeyEventHandler((event) => {
		if (
			event.type !== "keydown" ||
			!event.altKey ||
			event.ctrlKey ||
			event.metaKey
		) {
			return true;
		}
		const ctrlArrow = event.shiftKey
			? undefined
			: ALT_ARROW_AS_CTRL_ARROW[event.key];
		if (ctrlArrow) {
			event.preventDefault();
			term.input(ctrlArrow);
			return false;
		}
		if (isMac && event.key.length === 1) {
			event.preventDefault();
			term.input(event.key);
			return false;
		}
		return true;
	});
};
