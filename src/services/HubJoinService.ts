import BlacklistManager from '#main/managers/BlacklistManager.js';
import HubManager from '#main/managers/HubManager.js';
import { HubService } from '#main/services/HubService.js';

import { TranslationKeys } from '#types/TranslationKeys.d.ts';
import { createConnection } from '#utils/ConnectedListUtils.js';
import { emojis } from '#utils/Constants.js';
import db from '#utils/Db.js';
import { logJoinToHub } from '#utils/hub/logger/JoinLeave.js';
import { sendToHub } from '#utils/hub/utils.js';
import { supportedLocaleCodes, t } from '#utils/Locale.js';
import { check } from '#utils/ProfanityUtils.js';
import { getOrCreateWebhook, getReplyMethod } from '#utils/Utils.js';
import { stripIndents } from 'common-tags';
import {
  ChatInputCommandInteraction,
  GuildTextBasedChannel,
  MessageComponentInteraction,
} from 'discord.js';

export class HubJoinService {
  private readonly interaction:
    | ChatInputCommandInteraction<'cached'>
    | MessageComponentInteraction<'cached'>;
  private readonly locale: supportedLocaleCodes;
  private readonly hubService: HubService;

  constructor(
    interaction: ChatInputCommandInteraction<'cached'> | MessageComponentInteraction<'cached'>,
    locale: supportedLocaleCodes,
    hubService: HubService = new HubService(),
  ) {
    this.interaction = interaction;
    this.locale = locale;
    this.hubService = hubService;
  }

  async joinRandomHub(channel: GuildTextBasedChannel) {
    const hub = await db.hub.findMany({
      where: { private: false },
      orderBy: { connections: { _count: 'asc' } },
      take: 10,
    });

    const randomHub = hub[Math.floor(Math.random() * hub.length)];
    return await this.joinHub(channel, randomHub.name);
  }

  async joinHub(channel: GuildTextBasedChannel, hubInviteOrName: string | undefined) {
    if (!this.interaction.deferred) await this.interaction.deferReply({ ephemeral: true });

    const checksPassed = await this.runChecks(channel);
    if (!checksPassed) return false;

    const hub = await this.fetchHub(hubInviteOrName);
    if (!hub) {
      await this.interaction.followUp({
        content: t('hub.notFound', this.locale, { emoji: emojis.no }),
        ephemeral: true,
      });
      return false;
    }

    if ((await this.isAlreadyInHub(channel, hub.id)) || (await this.isBlacklisted(hub))) {
      return false;
    }

    const webhook = await this.createWebhook(channel);
    if (!webhook) return false;

    // Create the connection
    await createConnection({
      serverId: channel.guildId,
      channelId: channel.id,
      parentId: channel.isThread() ? channel.parentId : undefined,
      webhookURL: webhook.url,
      hub: { connect: { id: hub.id } },
      connected: true,
      compact: true,
      profFilter: true,
    });

    await this.sendSuccessMessages(hub, channel);
    return true;
  }

  private async runChecks(channel: GuildTextBasedChannel) {
    if (!channel.permissionsFor(this.interaction.member).has('ManageMessages', true)) {
      await this.replyError('errors.missingPermissions', {
        permissions: 'Manage Messages',
        emoji: emojis.no,
      });
      return false;
    }

    const { hasSlurs, hasProfanity } = check(this.interaction.guild.name);
    if (hasSlurs || hasProfanity) {
      await this.replyError('errors.serverNameInappropriate', { emoji: emojis.no });
      return false;
    }

    return true;
  }

  private async fetchHub(hubNameOrInvite?: string) {
    const hubName = hubNameOrInvite ?? 'InterChat Central';

    // Check if it's an invite code
    if (hubNameOrInvite) {
      const fetchedInvite = await db.hubInvite.findFirst({
        where: { code: hubNameOrInvite },
        include: { hub: true },
      });

      if (fetchedInvite) return new HubManager(fetchedInvite.hub);
    }

    // Otherwise search by name
    return await this.hubService.fetchHub({ name: hubName });
  }

  private async isAlreadyInHub(channel: GuildTextBasedChannel, hubId: string) {
    const channelInHub = await db.connection.findFirst({
      where: { OR: [{ channelId: channel.id }, { serverId: channel.guildId, hubId }] },
      include: { hub: { select: { name: true } } },
    });

    if (channelInHub) {
      await this.replyError('hub.alreadyJoined', {
        channel: `<#${channelInHub.channelId}>`,
        hub: `${channelInHub.hub?.name}`,
        emoji: emojis.no,
      });
      return true;
    }
    return false;
  }

  private async isBlacklisted(hub: HubManager) {
    const userBlManager = new BlacklistManager('user', this.interaction.user.id);
    const serverBlManager = new BlacklistManager('server', this.interaction.guildId);

    const userBlacklist = await userBlManager.fetchBlacklist(hub.id);
    const serverBlacklist = await serverBlManager.fetchBlacklist(hub.id);

    if (userBlacklist || serverBlacklist) {
      await this.replyError('errors.blacklisted', { emoji: emojis.no, hub: hub.data.name });
      return true;
    }

    return false;
  }

  private async createWebhook(channel: GuildTextBasedChannel) {
    const webhook = await getOrCreateWebhook(channel);
    if (!webhook) {
      await this.replyError('errors.botMissingPermissions', {
        permissions: 'Manage Webhooks',
        emoji: emojis.no,
      });
      return null;
    }
    return webhook;
  }

  private async sendSuccessMessages(hub: HubManager, channel: GuildTextBasedChannel) {
    const replyMethod = getReplyMethod(this.interaction);
    await this.interaction[replyMethod]({
      content: t('hub.join.success', this.locale, {
        channel: `${channel}`,
        hub: hub.data.name,
      }),
      embeds: [],
      components: [],
    });

    const totalConnections =
      (await hub.connections.toArray())?.reduce(
        (total, c) => total + (c.data.connected ? 1 : 0),
        0,
      ) ?? 0;

    const serverCountMessage =
      totalConnections === 0
        ? 'There are no other servers connected to this hub yet. *cricket noises* 🦗'
        : `We now have ${totalConnections} servers in this hub! 🎉`;

    // Announce to hub
    await sendToHub(hub.id, {
      username: `InterChat | ${hub.data.name}`,
      content: stripIndents`
        A new server has joined the hub! ${emojis.clipart}

        **Server Name:** __${this.interaction.guild.name}__
        **Member Count:** __${this.interaction.guild.memberCount}__

        ${serverCountMessage}
      `,
    });

    // Send log
    await logJoinToHub(hub.id, this.interaction.guild, {
      totalConnections,
      hubName: hub.data.name,
    });
  }

  private async replyError<K extends keyof TranslationKeys>(
    key: K,
    options?: { [key in TranslationKeys[K]]: string },
  ) {
    const content = t(key, this.locale, options);
    const replyMethod = getReplyMethod(this.interaction);

    await this.interaction[replyMethod]({
      content,
      ephemeral: true,
    });
  }
}
