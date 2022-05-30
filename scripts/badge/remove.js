module.exports = {
	async execute(interaction, dbCollection, user, badge) {
		const userInCollection = await dbCollection.findOne({ userId: user.id });

		if (userInCollection) {
			const userBadges = userInCollection.badges;

			if (userBadges.includes(badge)) {
				userBadges.splice(userBadges.indexOf(badge), 1);
				dbCollection.updateOne({ userId: user.id }, { $set: { badges: userBadges } });
				await interaction.reply(`Removed badge \`${badge}\` from user ${user.tag}.`);
			}
			else {
				await interaction.reply(`User ${user.tag} does not have the badge ${badge}.`);
			}
		}
		else {
			await interaction.reply(`User ${user.tag} does not have the badge ${badge}.`);
		}
	},
};