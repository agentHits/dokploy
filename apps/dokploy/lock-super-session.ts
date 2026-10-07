import { findOwner } from "@dokploy/server";
import { db } from "@dokploy/server/db";
import { user } from "@dokploy/server/db/schema";
import { closeSuperSession } from "@dokploy/server/services/super-password";
import { eq } from "drizzle-orm";

(async () => {
	try {
		const email = process.argv[2]?.trim().toLowerCase();

		let userId: string;

		if (email) {
			const foundUser = await db.query.user.findFirst({
				where: eq(user.email, email),
			});

			if (!foundUser) {
				console.log(`User not found for email: ${email}`);
				process.exit(1);
			}

			userId = foundUser.id;
		} else {
			const owner = await findOwner();
			userId = owner.userId;
		}

		await closeSuperSession(userId);

		console.log("Super session closed");
		process.exit(0);
	} catch (error) {
		console.log("Error closing the super session", error);
		process.exit(1);
	}
})();
