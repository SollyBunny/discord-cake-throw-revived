#!/bin/env node

import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import dotenv from "dotenv";
import { commands, interact } from "./commands.mjs";

dotenv.config();

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences] });

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// Register commands
(async () => {
	try {
		await rest.put(
			Routes.applicationCommands(process.env.CLIENT_ID),
			{ body: commands }
		);
		if (process.env.GUILD_ID) { // For development
			await rest.put(
				Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
				{ body: process.env.GUILD_COMMANDS_REMOVE ? [] : commands }
			);
		}
		console.log("Updated slash commands");
	} catch (error) {
		console.error(error);
	}
})();

// Bot logic

client.on("interactionCreate", interact);

client.login(process.env.TOKEN);
await new Promise(resolve => client.once("clientReady", resolve));

const servers = client.guilds.cache.size;
if (servers === 0) {
	console.error("No servers!? You probably didn't invite me with the bot scope");
	process.exit(1);
}
console.log(`Logged in as ${client.user.tag}, I am in ${servers} servers`);
