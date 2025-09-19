import Database from "better-sqlite3";

const db = new Database("cake.sqlite3");
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// Guilds
db.prepare(`
CREATE TABLE IF NOT EXISTS guilds (
	guildID TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	cakes INTEGER NOT NULL DEFAULT 0,
	points INTEGER NOT NULL DEFAULT 0
);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_guilds_cakes ON guilds (cakes);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_guilds_points ON guilds (points);
`).run();

// Users
db.prepare(`
CREATE TABLE IF NOT EXISTS users (
	ID TEXT PRIMARY KEY,
	cakes INTEGER NOT NULL DEFAULT 0,
	points INTEGER NOT NULL DEFAULT 0
);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_users_cakes ON users (cakes);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_users_points ON users (points);
`).run();

// Members (users in guilds)
db.prepare(`
CREATE TABLE IF NOT EXISTS members (
	ID TEXT NOT NULL,
	guildID TEXT NOT NULL,
	cakes INTEGER NOT NULL DEFAULT 0,
	points INTEGER NOT NULL DEFAULT 0,
	cakesToday INTEGER,
	cakesTodayReset INTEGER,
	PRIMARY KEY (ID, guildID),
	FOREIGN KEY (ID) REFERENCES users(ID) ON DELETE CASCADE,
	FOREIGN KEY (guildID) REFERENCES guilds(guildID) ON DELETE CASCADE
);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_members_cakes ON members (cakes);
`).run();
db.prepare(`
	CREATE INDEX IF NOT EXISTS idx_members_points ON members (points);
`).run();

/**
 * Get the top entries from the database.
 *
 * @param {"guilds" | "users" | "members"} type - The table to query.
 * @param {"cakes" | "points"} sort - The column to sort by.
 * @param {number} number - The number of results to return per page.
 * @param {number} page - The page number (1-based).
 * @param {number | null} guildID - ID of the guild for members table.
 * @returns {Array<object>} The top rows from the specified table, sorted and paginated.
 */
export function getTop(type, sort, number, page, guildID) {
	if (!["guilds", "users", "members"].includes(type))
		throw new Error(`Invalid type: ${type}`);
	if (!["cakes", "points"].includes(sort))
		throw new Error(`Invalid sort column: ${sort}`);
	if (number <= 0)
		throw new Error("Number must be greater than 0");
	if (page <= 0)
		throw new Error("Page must be greater than 0");

	const offset = (page - 1) * number;
	if (type === "members") {
		if (!guildID)
			throw new Error("guildID must be provided");
		return db.prepare(`
			SELECT *
			FROM ${type}
			WHERE guildID = ?
			ORDER BY ${sort} DESC
			LIMIT ? OFFSET ?
		`).all(guildID, number, offset);
	} else {
		return db.prepare(`
			SELECT *
			FROM ${type}
			ORDER BY ${sort} DESC
			LIMIT ? OFFSET ?
		`).all(number, offset);
	}
}

/**
 * Get a single entry from the database by its ID.
 *
 * @param {"guilds" | "users" | "members"} type - The table to query.
 * @param {string} ID - The ID of the entry to fetch.
 * @returns {object | null} The matching row, or null if not found.
 */
export function getSingle(type, ID) {
	if (!["guilds", "users", "members"].includes(type))
		throw new Error(`Invalid type: ${type}`);
	if (!ID)
		throw new Error("ID must be provided");

	// Determine correct column name for ID lookup
	const IDColumn = type === "guilds" ? "guildID" : "ID";

	return db.prepare(`
		SELECT *
		FROM ${type}
		WHERE ${IDColumn} = ?
		LIMIT 1
	`).get(ID);
}

/**
 * Add points (and increment cakes by 1) for a user and optionally their membership in a guild.
 * Also ensures the guild exists.
 *
 * @param {string} ID - The user's ID.
 * @param {string} guildID - The guild ID.
 * @param {string} guildName - The guild name.
 * @param {number} points - The number of points to add.
 * @param {number} maxCakesToday - Maximum number of cakes to allow per day.
 * @returns {{ user: object, member: object | null }} The updated data.
 */
export function addPoints(ID, guildID, guildName, points, maxCakesToday) {
	if (!ID)
		throw new Error("ID must be provided");
	if (!guildID)
		throw new Error("guildID must be provided");

	const tx = db.transaction(() => {
		// 1. Ensure guild, user and member exists
		db.prepare(`
			INSERT INTO guilds (guildID, name)
			VALUES (?, ?)
			ON CONFLICT(guildID) DO NOTHING
		`).run(guildID, guildName);
		db.prepare(`
			INSERT INTO users (ID)
			VALUES (?)
			ON CONFLICT(ID) DO NOTHING
		`).run(ID);
		db.prepare(`
			INSERT INTO members (ID, guildID)
			VALUES (?, ?)
			ON CONFLICT(ID, guildID) DO NOTHING
		`).run(ID, guildID);

		// 2. Fetch member
		const member = db.prepare(`SELECT * FROM members WHERE ID = ? AND guildID = ?`).get(ID, guildID);

		// 3. Reset cakesToday if a new day has started
		const now = Math.floor(Date.now() / 1000); // Unix seconds
		if (!member.cakesTodayReset || now - member.cakesTodayReset >= 24 * 60 * 60) {
			db.prepare(`
				UPDATE members
				SET cakesToday = 0, cakesTodayReset = ?
				WHERE ID = ? and guildID = ?
			`).run(now, ID, guildID);
			member.cakesToday = 0;
			member.cakesTodayReset = now;
		}

		// 3. Update points and cakes if below max
		member.success = member.cakesToday < maxCakesToday;
		if (member.success) {
			db.prepare(`
				UPDATE guilds
				SET name = ?, points = points + ?, cakes = cakes + 1
				WHERE guildID = ?
			`).run(guildName, points, guildID);
			db.prepare(`
				UPDATE users
				SET points = points + ?, cakes = cakes + 1
				WHERE ID = ?
			`).run(points, ID);
			db.prepare(`
				UPDATE members
				SET points = points + ?, cakes = cakes + 1, cakesToday = cakesToday + 1
				WHERE ID = ? AND guildID = ?
			`).run(points, ID, guildID);
			member.points += points;
			member.cakes += 1;
			member.cakesToday += 1;
		}

		return member;
	});

	return tx();
}

/**
 * Delete all data for a user.
 * Removes their points/cakes from guild totals, deletes members, deletes the user,
 * and removes any guilds whose cakes drop to 0.
 *
 * @param {string} ID - The user ID to delete.
 * @returns {false | Object} False if nothing was deleted, otherwise the user that was deleted.
 */
export function deleteData(ID) {
	if (!ID)
		throw new Error("ID must be provided");

	const tx = db.transaction(() => {
		// 1. Check if the user exists
		const user = db.prepare(`SELECT * FROM users WHERE ID = ?`).get(ID);
		if (!user)
			return false;

		// 2. Adjust guild totals
		const members = db.prepare(`
			SELECT guildID, cakes, points
			FROM members
			WHERE ID = ?
		`).all(ID);

		for (const { guildID, cakes, points } of members) {
			db.prepare(`
				UPDATE guilds
				SET cakes = cakes - ?, points = points - ?
				WHERE guildID = ?
			`).run(cakes, points, guildID);
		}

		// 3. Delete stuff
		db.prepare(`DELETE FROM members WHERE ID = ?`).run(ID);
		db.prepare(`DELETE FROM users WHERE ID = ?`).run(ID);
		db.prepare(`DELETE FROM guilds WHERE cakes = 0`).run();

		return user;
	});

	return tx();
}
