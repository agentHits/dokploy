import {
	checkSuperSessionAccess,
	SUPER_SESSION_MESSAGES,
	type SuperSessionDenial,
} from "@dokploy/server/services/super-password";
import type { WebSocket } from "ws";

type TerminalUser = { id: string } | null | undefined;
type TerminalSession = { authMethod?: string | null } | null | undefined;

// Host, server and container shells are dangerous actions: a user with a super
// password needs the browser session and an open super session.
export const getTerminalSuperSessionDenial = async (
	user: TerminalUser,
	session: TerminalSession,
): Promise<SuperSessionDenial | null> => {
	if (!user) {
		return "super-session-required";
	}
	try {
		return await checkSuperSessionAccess({
			userId: user.id,
			kind: "dangerous",
			viaApiKey: session?.authMethod === "api-key",
		});
	} catch (error) {
		console.error("Failed to check the super session for a terminal", error);
		return "super-session-required";
	}
};

export const rejectTerminalWithoutSuperSession = async (
	ws: Pick<WebSocket, "send" | "close">,
	user: TerminalUser,
	session: TerminalSession,
) => {
	const denial = await getTerminalSuperSessionDenial(user, session);
	if (!denial) {
		return false;
	}
	ws.send(`${SUPER_SESSION_MESSAGES[denial]}\n`);
	ws.close(4003, "Super password required");
	return true;
};
