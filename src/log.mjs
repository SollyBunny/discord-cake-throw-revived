import fs from "fs";

const logFile = "logs";

export function logError(message) {
	const timestamp = new Date().toISOString();
	message = `[${timestamp}] Error: ${message}`;
	console.error(message);
	fs.appendFileSync(logFile, message + "\n");
}

export function logInfo(message) {
	const timestamp = new Date().toISOString();
	message = `[${timestamp}] ${message}`;
	console.log(message);
	fs.appendFileSync(logFile, message + "\n");
}

process.on('uncaughtException', err => {
	logError(err.stack || err);
});
process.on("unhandledRejection", reason => {
	logError(reason instanceof Error ? (reason.stack || reason) : new Error(JSON.stringify(reason)));
});

logInfo("Program started");
