import { emojis } from '#main/config/Constants.js';
import { deleteConnections } from '#utils/ConnectedListUtils.js';
import { logBlacklist, logServerUnblacklist } from '#utils/HubLogger/ModLogs.js';
import { t } from '#utils/Locale.js';
import { type ChatInputCommandInteraction, type Snowflake } from 'discord.js';
import parse from 'parse-duration';
import BlacklistCommand from './index.js';
import ServerInfractionManager from '#main/managers/InfractionManager/ServerInfractionManager.js';
import { sendBlacklistNotif } from '#utils/moderation/blacklistUtils.js';
import BlacklistManager from '#main/managers/BlacklistManager.js';

export default class extends BlacklistCommand {
  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply();

    const { id: moderatorId } = interaction.user;
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    const hubName = interaction.options.getString('hub');
    const hub = await this.getHub({ name: hubName, userId: moderatorId });
    if (!this.isValidHub(interaction, hub, locale)) return;

    const subCommandGroup = interaction.options.getSubcommandGroup();
    const serverId = interaction.options.getString('server', true);

    const blacklistManager = new BlacklistManager(new ServerInfractionManager(serverId));

    if (subCommandGroup === 'add') {
      const reason = interaction.options.getString('reason', true);
      const duration = parse(`${interaction.options.getString('duration')}`);
      const expires = duration ? new Date(Date.now() + duration) : null;

      const checksPassed = await this.runAddChecks(interaction, hub.id, serverId, { duration });
      if (!checksPassed) return;

      const server = await interaction.client.fetchGuild(serverId).catch(() => null);
      if (!server) {
        await interaction.followUp(t('errors.unknownServer', locale, { emoji: emojis.no }));
        return;
      }

      await blacklistManager.addBlacklist({
        reason,
        expiresAt: expires,
        moderatorId,
        serverName: server.name,
        hubId: hub.id,
      });

      await sendBlacklistNotif('server', interaction.client, {
        target: { id: serverId },
        hubId: hub.id,
        expiresAt: expires,
        reason,
      });

      await this.sendSuccessResponse(
        interaction,
        t('blacklist.success', locale, { name: server.name, emoji: emojis.tick }),
        { reason, expires },
      );

      // delete all connections from db so they can't reconnect to the hub
      await deleteConnections({ serverId, hubId: hub.id });

      // send log to hub's log channel
      await logBlacklist(hub.id, interaction.client, {
        target: serverId,
        mod: interaction.user,
        reason,
        expiresAt: expires,
      });
    }
    else if (subCommandGroup === 'remove') {
      const result = await blacklistManager.removeBlacklist(hub.id);

      if (!result) {
        await this.replyEmbed(
          interaction,
          t('errors.serverNotBlacklisted', locale, { emoji: emojis.no }),
        );
        return;
      }

      // Using name from DB since the bot can't access server through API.
      await this.replyEmbed(
        interaction,
        t('blacklist.removed', locale, { emoji: emojis.delete, name: result.serverName }),
      );

      // send log to hub's log channel
      await logServerUnblacklist(interaction.client, hub.id, {
        id: serverId,
        mod: interaction.user,
      });
    }
  }
  private async runAddChecks(
    interaction: ChatInputCommandInteraction,
    hubId: string,
    serverId: Snowflake,
    opts: { duration?: number },
  ) {
    const blacklistManager = new BlacklistManager(new ServerInfractionManager(serverId));
    const blacklist = await blacklistManager.fetchBlacklist(hubId);
    const hiddenOpt = { ephemeral: true };

    if (blacklist) {
      await this.replyEmbed(
        interaction,
        t('blacklist.server.alreadyBlacklisted', 'en', { emoji: emojis.no }),
        hiddenOpt,
      );
      return false;
    }
    if (opts?.duration && opts.duration < 30_000) {
      await this.replyEmbed(
        interaction,
        `${emojis.no} Blacklist duration should be atleast 30 seconds or longer.`,
        hiddenOpt,
      );
      return false;
    }
    return true;
  }
}
