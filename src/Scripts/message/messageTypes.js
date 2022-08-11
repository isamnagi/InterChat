const { normal } = require('../../utils/emoji.json');

module.exports = {
	/**
	 * This function converts a message to embeded or normal depending on the server settings. It also adds the attachments to the message.
	 * @param {import ('discord.js').Client} client Discord.js client
	 * @param {import ('discord.js').Message} message The discord message object not the message string
	 * @param {*} channelObj Channel in collection to check
	 * @param {import ('discord.js').EmbedBuilder} embed The Embed you want to send to the channel
	 * @param {import ('mongodb').Db} setupDb Database of setup
	 * @param {import ('discord.js').Attachment} attachments Message attachments
	 * @returns {Promise<import ('discord.js').Message>}
	 *
	 */
	execute: async (client, message, channelObj, embed, setupDb, attachments) => {
		const allChannel = await client.channels.fetch(channelObj.channelId);
		const channelInDB = await setupDb.findOne({ 'channel.id': allChannel.id });

		if (channelInDB?.compact === true && allChannel == message.channel.id) {
			return webhookAutomate(message.channel);
		}
		else if (channelInDB?.compact === true && allChannel == channelInDB.channel.id) {
			return webhookAutomate(allChannel);
		}
		// TODO: Make sending images a voter only feature, so that random people won't send inappropriate images
		else if (attachments) {
			await message.channel.send('Warn: Sending images directly is currently experimental, so it might take a few seconds to send images!');
			return await allChannel.send({ embeds: [embed], files: [attachments], allowedMentions: { parse: ['roles'] } });
		}

		else {
			return await allChannel.send({ embeds: [embed], allowedMentions: { parse: ['roles'] } });
		}


		async function webhookAutomate(chan) {
			const webhookMessage = {
				content: message.content,
				username: message.author.username,
				avatarURL: message.author.avatarURL(),
				allowedMentions: { parse: [] },
			};
			const normalMessage = {
				content: `**${message.author.tag}:** ${message.content}`,
				allowedMentions: { parse: [] },
			};

			if (attachments) {
				webhookMessage.files = [attachments];
				normalMessage.files = [attachments];
			}

			try {
				const webhooks = await chan.fetchWebhooks();
				const webhook = webhooks.find(wh => wh.token);

				if (!webhook) return await allChannel.send(normalMessage);
				else return await webhook.send(webhookMessage);
			}
			catch (error) {
				allChannel.send(`${normal.no} Unable to send webhook message! \n**Error:** ${error.message}`);
			}
		}
	},
};