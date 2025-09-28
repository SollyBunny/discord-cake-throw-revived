import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";

import * as Points from "./db/points.mjs";
import CONFIG from "./config.mjs";

function weightedRandomChoice(choices) {
	const totalWeight = choices.reduce((sum, { weight }) => sum + weight, 0);
	let r = Math.random() * totalWeight;
	for (const choice of choices) {
		if (r < choice.weight)
			return choice;
		r -= choice.weight;
	}
	return choices[choices.length - 1];
}

export const commands = [
	new SlashCommandBuilder()
		.setName("invite")
		.setDescription("Invite this bot")
		.toJSON(),
	new SlashCommandBuilder()
		.setName("magic8ball")
		.addStringOption(option => option.setName("what")
			.setDescription("What to get life advice about")
			.setRequired(false))
		.setDescription("Get life advice")
		.toJSON(),
	new SlashCommandBuilder()
		.setName("deletedata")
		.setDescription("Delete all your user data")
		.toJSON(),
	new SlashCommandBuilder()
		.setName("leaderboard")
		.setDescription("View the leaderboard")
		.addStringOption(option => option.setName("type")
			.setDescription("Sort by cakes or points")
			.addChoices(
				{ name: "members", value: "members" },
				{ name: "users", value: "users" },
				{ name: "guilds", value: "guilds" }
			)
			.setRequired(true))
		.addStringOption(option => option.setName("sort")
			.setDescription("Sort by cakes or points")
			.addChoices(
				{ name: "cakes", value: "cakes" },
				{ name: "points", value: "points" }
			)
			.setRequired(false))
		.toJSON(),
	new SlashCommandBuilder()
		.setName("cake")
		.setDescription("Throw a cake at someone!")
		.addUserOption(option =>
			option.setName("target")
				.setDescription("The person you want to throw a cake at")
				.setRequired(false)
		)
		.toJSON(),
];

let getRandomGifCache;
async function getRandomGif() {
	if (!getRandomGifCache) {
		let data;
		data = await fetch(CONFIG.assets + "index.txt");
		data = await data.text();
		data = data.split("\n");
		data = data.filter(i => i && !i.startsWith("#"));
		getRandomGifCache = data;
	}
	return CONFIG.assets + getRandomGifCache[Math.floor(Math.random() * getRandomGifCache.length)];
}

/**
 * @param {import("discord.js").BaseInteraction} interaction
 */
async function interactReply(interaction, { title, message, extra }) {
	const embed = new EmbedBuilder()
		.setTitle(title)
		.setDescription(message)
		.setThumbnail(CONFIG.assets + "icon.png")
		.setColor(CONFIG.color);
	const out = { embeds: [embed] }
	if (extra)
		await extra(out);
	await interaction.reply(out);
}

/**
 * @param {import("discord.js").BaseInteraction} interaction
 */
async function interactError(interaction, error) {
	const embed = new EmbedBuilder()
		.setTitle(":ghost: Uhh...")
		.setDescription(error)
		.setThumbnail(CONFIG.assets + "icon.png")
		.setColor(CONFIG.color);
	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

function memberGetDisplayName(member) {
	if (!member)
		return "Ghost";
	return member.displayName ?? member.nickname ?? member.nick ?? member.user?.global_name ?? member.user?.username ?? member.user?.id ?? "Ghost";
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction | import("discord.js").ButtonInteraction} interaction
 * @param {Number} ID
 * @returns {Promise<import("discord.js").GuildMember | import("discord.js").User | undefined>}
 */
async function interactionGetMemberOrUserOrCry(interaction, ID) {
	if (!ID)
		throw new Error("ID is required");
	if (interaction.guild) {
		try {
			return await interaction.guild.members.fetch(ID);
		} catch (e) {
			;
		}
	}
	try {
		return await interaction.client.users.fetch(ID);
	} catch (e) {
		;
	}
}

/**
 * @param {import("discord.js").ChatInputCommandInteraction | import("discord.js").ButtonInteraction} interaction
 */
export async function interact(interaction) {
	const interactionName = interaction.isChatInputCommand() ? interaction.commandName : interaction.customId;
	if (interactionName === "invite") {
		await interaction.reply(`https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}`);
	} else if (interactionName === "magic8ball") {
		await interactReply(interaction, {
			title: ":8ball: Magic 8 Ball",
			message: CONFIG.magic8ball[Math.floor(Math.random() * CONFIG.magic8ball.length)]
		});
	} else if (interactionName === "leaderboard") {
		const type = interaction.options?.getString("type") ?? "members";
		const sort = interaction.options?.getString("sort") ?? "points";
		if (type === "members" && !interaction.guildId) {
			await interactReply(interaction, {
				title: "Oops!",
				message: "You can only get member leaderboard in servers!"
			});
			return;
		}
		const data = Points.getTop(type, sort, 10, 1, interaction.guildId);
		let message = "";
		for (const [i, row] of Object.entries(data)) {
			const name = type === "guilds" ? row.name : memberGetDisplayName(await interactionGetMemberOrUserOrCry(interaction, row.ID));
			const value = sort === "cakes" ? `${row.cakes} cakes` : `${row.points} points`;
			message += `**${Number(i) + 1}**. ${name} (${value})\n`;
		}
		if (!message)
			message = "No one yet :sob:";
		let title = ":trophy: ";
		if (type === "guilds")
			title += "Top servers";
		else if (type === "users")
			title += "Top users in all servers";
		else if (type === "members")
			title += "Top users in this server";
		await interactReply(interaction, { title, message });
	} else if (interactionName === "deletedata") {
		const user = Points.getSingle("users", interaction.user.id);
		if (!user) {
			await interactError(interaction, "You have no data to delete!");
			return;
		}
		await interactReply(interaction, {
			title: ":wastebasket: Delete all your data",
			message: `Are you sure?\nThis includes ${user.points} points made over ${user.cakes} throws.`,
			extra: out => {
				out.flags = MessageFlags.Ephemeral;
				out.components = [new ActionRowBuilder().addComponents(
					new ButtonBuilder()
						.setCustomId("deletedataconfirm")
						.setLabel("Yes, I am sure.")
						.setStyle(ButtonStyle.Danger),
					new ButtonBuilder()
						.setCustomId("deletedatacancel")
						.setLabel("No! Abort!")
						.setStyle(ButtonStyle.Primary)
				)];
			}
		});
	} else if (interactionName === "deletedataconfirm") {
		await Points.deleteData(interaction.user.id);
		await interaction.update({
			embeds: [
				new EmbedBuilder()
					.setTitle(":wastebasket: Delete all your data")
					.setDescription(`Deleted all your data!`)
					.setThumbnail(CONFIG.assets + "icon.png")
					.setColor(CONFIG.color)
			],
			components: []
		});
	} else if (interactionName === "deletedatacancel") {
		await interaction.update({
			embeds: [
				new EmbedBuilder()
					.setTitle(":wastebasket: Delete all your data")
					.setDescription("Operation aborted!")
					.setThumbnail(CONFIG.assets + "icon.png")
					.setColor(CONFIG.color)
			],
			components: []
		});
	} else if (interactionName.startsWith("cake")) {
		/**
		 * @param {import("discord.js").ChatInputCommandInteraction | import("discord.js").ButtonInteraction} interaction
		 * @param {Number} targetID
		 * @param {Boolean} ping
		 */
		async function interactCake(interaction, targetID, ping) {
			const target = await interactionGetMemberOrUserOrCry(interaction, targetID);
			if (!target) {
				await interactError(interaction, "You have somehow managed to cake a ghost, good job.");
				return;
			}
			/** @type {import("discord.js").User} */
			const targetUser = target.user ?? target;
			if (targetUser.bot) {
				await interactError(interaction, "You can't throw a cake at a bot!");
				return;
			}
			if (targetUser.id === interaction.user.id) {
				await interactError(interaction, "I appreciate the enthusiasm, but you can't cake yourself.");
				return;
			}

			const outcome = weightedRandomChoice(CONFIG.outputs);
			const throwerName = memberGetDisplayName(interaction.member);
			const targetName = memberGetDisplayName(target);

			const out = Points.addPoints(interaction.user.id, interaction.guildId, interaction.guild?.name, outcome.value, CONFIG.maxCakesToday);
			if (!out.success) {
				await interactError(interaction, `You have run out of cakes for today, cakes will refresh <t:${out.cakesTodayReset + 24 * 60 * 60}:R>`);
				return;
			}

			console.log(`${throwerName} threw at ${targetName} (${outcome.value > 0 ? "+" : ""}${outcome.value})`);
			await interactReply(interaction, {
				title: outcome.title,
				message: (out.cakes === 1 ? `This is **${throwerName}**'s first cake throw in this server!\n` : "")
					+ outcome.messages[Math.floor(Math.random() * outcome.messages.length)].replaceAll("%a", `**${throwerName}**`).replaceAll("%b", `**${targetName}**`)
					+ `\n${outcome.value > 0 ? "+" : ""}${outcome.value} :cake: point${outcome.value === 1 ? "" : "s"}`,
				extra: async out => {
					if (ping)
						out.content = `<@${targetID}>`;
					out.embeds[0].setImage(await getRandomGif());
					out.components = [new ActionRowBuilder().addComponents(
						new ButtonBuilder()
							.setCustomId(`cake:${interaction.user.id},${targetID}`)
							.setLabel("Throw another")
							.setStyle(ButtonStyle.Danger),
						new ButtonBuilder()
							.setCustomId("leaderboard")
							.setLabel("Leaderboard")
							.setStyle(ButtonStyle.Primary)
					)];
				}
			});
		}
		if (interaction.guild === null) {
			if (interact.guildId !== null) {
				await interactReply(interaction, {
					title: "Oops!",
					message: "I'm in this server without the bot scope, please reinvite me",
					extra: out =>
						out.content = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}`
				});
				return;
			}
			await interactReply(interaction, {
				title: "Oops!",
				message: "You can only /cake in servers!"
			});
			return;
		}
		if (interactionName === "cake") {
			let targetID = interaction.options.getUser("target")?.id;
			if (!targetID) {
				targetID = interaction.guild.members.cache
					.filter(i => !i.user.bot && i.user.id !== interaction.user.id)
					.randomKey()
				if (!targetID) {
					await interactError("Sorry I'm too dumb to figure out who you want to throw a cake at");
					return;
				}
			}
			await interactCake(interaction, targetID, true);
		} else {
			if (!interactionName.includes(":"))
				return; // Old
			const [throwerID, targetID] = interactionName.slice("cake:".length).split(",");
			if (targetID === interaction.user.id) // Prevent self throw
				await interactCake(interaction, throwerID);
			else
				await interactCake(interaction, targetID);
		}
	}
}
