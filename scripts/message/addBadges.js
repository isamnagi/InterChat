const emoji = require('../../emoji.json');
module.exports = {
	async execute(message, database, embed) {
		const badges = await database.collection('userBadges').findOne({ userId: message.author.id });

		if (!badges) return;

		if (badges.badges.length > 0) {
			let badgeString = '';
			for (const badge of badges.badges) {
				if (badge === 'Developer') {
					badgeString += emoji.badge.badge_developer + '\u200B ';
				}
				else if (badge === 'Staff') {
					badgeString += emoji.badge.badge_staff + '\u200B ';
				}
				else if (badge === 'Premium') {
					badgeString += emoji.badge.badge_premium + '\u200B ';
				}
			}
			embed.setTitle(badgeString.slice(0, -1));
		}
	},
};