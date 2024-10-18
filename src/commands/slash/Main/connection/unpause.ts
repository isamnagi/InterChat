import { emojis } from '#main/config/Constants.js';
import { fetchCommands, findCommand } from '#utils/CommandUtils.js';
import { updateConnection } from '#utils/ConnectedListUtils.js';
import db from '#utils/Db.js';
import { t } from '#utils/Locale.js';
import { getOrCreateWebhook } from '#utils/Utils.js';
import {
  ChannelType,
  ChatInputCommandInteraction,
  channelMention,
  chatInputApplicationCommandMention as slashCmdMention,
} from 'discord.js';
import Connection from './index.js';

export default class Unpause extends Connection {
  override async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const channelId = interaction.options.getString('channel', true);
    const connected = await db.connectedList.findFirst({ where: { channelId } });
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    if (!connected) {
      await this.replyEmbed(interaction, `${emojis.no} That channel is not connected to a hub!`, {
        ephemeral: true,
      });
      return;
    }

    if (connected.connected) {
      await this.replyEmbed(
        interaction,
        `${emojis.no} This connection is not paused! Use \`/connection pause\` to pause your connection.`,
        { ephemeral: true },
      );
      return;
    }

    const channel = await interaction.guild?.channels.fetch(channelId).catch(() => null);

    if (!channel?.isThread() && channel?.type !== ChannelType.GuildText) {
      await this.replyEmbed(
        interaction,
        t('connection.channelNotFound', locale, { emoji: emojis.no }),
        { ephemeral: true },
      );
      return;
    }

    await interaction.reply(
      `${emojis.loading} Checking webhook status... May take a few seconds if it needs to be re-created.`,
    );

    const webhook = await getOrCreateWebhook(channel).catch(() => null);
    if (!webhook) {
      await this.replyEmbed(
        interaction,
        t('errors.botMissingPermissions', locale, {
          emoji: emojis.no,
          permissions: 'Manage Webhooks',
        }),
      );
      return;
    }

    // reconnect the channel
    await updateConnection({ channelId }, { connected: true, webhookURL: webhook.url });

    let pause_cmd = '`/connection pause`';
    let edit_cmd = '`/connection edit`';

    const command = findCommand('connection', await fetchCommands(interaction.client));
    if (command) {
      pause_cmd = slashCmdMention('connection', 'pause', command.id);
      edit_cmd = slashCmdMention('connection', 'edit', command.id);
    }

    await this.replyEmbed(
      interaction,
      t('connection.unpaused.desc', locale, {
        tick_emoji: emojis.tick,
        channel: channelMention(channelId),
      }),
      {
        edit: true,
        content: t('connection.unpaused.tips', locale, { pause_cmd, edit_cmd }),
      },
    );
  }
}
