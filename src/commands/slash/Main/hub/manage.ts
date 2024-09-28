import Constants, { emojis } from '#main/config/Constants.js';
import { RegisterInteractionHandler } from '#main/decorators/Interaction.js';
import { HubSettingsString } from '#main/modules/BitFields.js';
import HubSettingsManager from '#main/modules/HubSettingsManager.js';
import { setComponentExpiry } from '#main/utils/ComponentUtils.js';
import { CustomID, ParsedCustomId } from '#main/utils/CustomID.js';
import db from '#main/utils/Db.js';
import { InfoEmbed } from '#main/utils/EmbedUtils.js';
import { genLogInfoEmbed } from '#main/utils/hub/logs.js';
import { actionsSelect, hubEmbed } from '#main/utils/hub/manage.js';
import { buildSettingsMenu } from '#main/utils/hub/settings.js';
import { sendToHub } from '#main/utils/hub/utils.js';
import { setLogChannelFor } from '#main/utils/HubLogger/Default.js';
import { removeReportsFrom, setReportRole } from '#main/utils/HubLogger/Report.js';
import { checkAndFetchImgurUrl } from '#main/utils/ImageUtils.js';
import { supportedLocaleCodes, t } from '#main/utils/Locale.js';
import type { Hub, Prisma } from '@prisma/client';
import {
  ActionRowBuilder,
  type APIRole,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  type MessageComponentInteraction,
  ModalBuilder,
  type ModalSubmitInteraction,
  type Role,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import HubCommand from './index.js';

export default class Manage extends HubCommand {
  async execute(interaction: ChatInputCommandInteraction) {
    const { hubInDb, locale } = await this.getInitialData(interaction);
    if (!hubInDb) return;

    const button = this.createManageButtons(interaction.user.id, hubInDb.id);

    await interaction.reply({
      embeds: [await hubEmbed(hubInDb)],
      components: [actionsSelect(hubInDb.id, interaction.user.id, locale), button],
    });

    await this.setComponentExpiry(interaction);
  }

  @RegisterInteractionHandler('hub_manage', 'settingsSelect')
  async handleSettingsSelect(interaction: MessageComponentInteraction) {
    if (!interaction.isStringSelectMenu()) return;

    const { hubInDb, customId } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    if (customId.suffix !== 'settingsSelect') return;

    const selected = interaction.values[0] as HubSettingsString;
    await this.updateSetting(interaction, hubInDb, selected, customId);
  }

  @RegisterInteractionHandler('hub_manage', 'logsSelect')
  async handleLogsSelect(interaction: MessageComponentInteraction) {
    if (!interaction.isStringSelectMenu()) return;

    const { hubInDb, customId, locale } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    if (customId.suffix !== 'logsSelect') return;

    const type = interaction.values[0] as keyof Prisma.HubLogChannelsCreateInput;
    await this.showLogConfigMenu(interaction, hubInDb, type, locale);
  }

  @RegisterInteractionHandler('hub_manage', 'actions')
  async handleActionsSelect(interaction: MessageComponentInteraction) {
    if (!interaction.isStringSelectMenu()) return;

    const { hubInDb, locale } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    const action = interaction.values[0];
    await this.handleAction(interaction, hubInDb, action, locale);
  }

  @RegisterInteractionHandler('hub_manage', 'logsChSel')
  async handleChannelSelects(interaction: MessageComponentInteraction) {
    if (!interaction.isChannelSelectMenu()) return;

    const { hubInDb, customId, locale } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    const type = customId.args[2] as keyof Prisma.HubLogChannelsCreateInput;
    const channel = interaction.channels.first();
    if (!channel) return;

    await this.updateLogChannel(interaction, hubInDb, type, channel.id, locale);
  }

  @RegisterInteractionHandler('hub_manage', 'logsRoleSel')
  async handleRoleSelects(interaction: MessageComponentInteraction) {
    if (!interaction.isRoleSelectMenu()) return;

    const { hubInDb, customId, locale } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    const role = interaction.roles.first();
    const type = customId.args[2] as keyof Prisma.HubLogChannelsCreateInput;

    await this.updateReportRole(interaction, hubInDb, type, role, locale);
  }

  @RegisterInteractionHandler('hub_manage_modal')
  async handleModals(interaction: ModalSubmitInteraction) {
    const { hubInDb, customId, locale } = await this.modalChecks(interaction);
    if (!hubInDb) return;

    switch (customId.suffix) {
      case 'description':
        await this.updateDescription(interaction, hubInDb.id, locale);
        break;
      case 'icon':
        await this.updateIcon(interaction, hubInDb.id, locale);
        break;
      case 'banner':
        await this.updateBanner(interaction, hubInDb.id, locale);
        break;
    }

    await this.updateOriginalMessage(interaction, hubInDb.id);
  }

  @RegisterInteractionHandler('hub_manage')
  async handleButtons(interaction: MessageComponentInteraction) {
    if (!interaction.isButton()) return;

    const { hubInDb, customId, locale } = await this.componentChecks(interaction);
    if (!hubInDb) return;

    switch (customId.suffix) {
      case 'settingsBtn':
        await this.showSettingsMenu(interaction, hubInDb, customId);
        break;
      case 'logsBtn':
      case 'logsBackBtn':
        await this.showLogsMenu(interaction, hubInDb, customId, locale);
        break;
      case 'logsDel':
        await this.deleteLogChannel(interaction, hubInDb, customId, locale);
        break;
    }
  }

  // Helper methods...

  private async getInitialData(interaction: ChatInputCommandInteraction) {
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);
    const chosenHub = interaction.options.getString('hub', true);
    const hubInDb = await this.fetchHubFromDb(interaction.user.id, chosenHub);

    if (!hubInDb) {
      await this.replyEmbed(
        interaction,
        t({ phrase: 'hub.notFound_mod', locale }, { emoji: emojis.no }),
      );
      return { hubInDb: null, locale };
    }

    return { hubInDb, locale };
  }

  private async fetchHubFromDb(userId: string, hubName: string) {
    return await db.hub.findFirst({
      where: {
        name: hubName,
        OR: [{ ownerId: userId }, { moderators: { some: { userId, position: 'manager' } } }],
      },
      include: { connections: true },
    });
  }

  private createManageButtons(userId: string, hubId: string) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Settings')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.settings)
        .setCustomId(new CustomID('hub_manage:settingsBtn', [userId, hubId]).toString()),
      new ButtonBuilder()
        .setLabel('Logging')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(emojis.store)
        .setCustomId(new CustomID('hub_manage:logsBtn', [userId, hubId]).toString()),
    );
  }

  private async setComponentExpiry(interaction: ChatInputCommandInteraction) {
    const reply = await interaction.fetchReply();
    setComponentExpiry(interaction.client.getScheduler(), reply, 60 * 5000);
  }

  private async updateSetting(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    selected: HubSettingsString,
    customId: ParsedCustomId,
  ) {
    if (selected === 'BlockNSFW') {
      await this.replyEmbed(
        interaction,
        `${emojis.no} This setting cannot be changed yet. Please wait for the next update.`,
        { ephemeral: true },
      );
      return;
    }

    const settingsManager = new HubSettingsManager(hubInDb.id, hubInDb.settings);
    await settingsManager.updateSetting(selected);

    const selects = buildSettingsMenu(
      settingsManager.getAllSettings(),
      hubInDb.id,
      customId.args[0],
    );

    await interaction.update({
      embeds: [settingsManager.getSettingsEmbed()],
      components: [selects],
    });
  }

  private async showLogConfigMenu(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    type: keyof Prisma.HubLogChannelsCreateInput,
    locale: supportedLocaleCodes,
  ) {
    const channelSelect = new ActionRowBuilder<ChannelSelectMenuBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(
          new CustomID('hub_manage:logsChSel', [interaction.user.id, hubInDb.id, type]).toString(),
        )
        .addChannelTypes(ChannelType.GuildText, ChannelType.PublicThread, ChannelType.PrivateThread)
        .setPlaceholder(t({ phrase: 'hub.manage.logs.channelSelect', locale })),
    );

    const roleSelect = new ActionRowBuilder<RoleSelectMenuBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(
          new CustomID('hub_manage:logsRoleSel', [
            interaction.user.id,
            hubInDb.id,
            type,
          ]).toString(),
        )
        .setPlaceholder(t({ phrase: 'hub.manage.logs.roleSelect', locale })),
    );

    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setEmoji(emojis.back)
        .setStyle(ButtonStyle.Secondary)
        .setCustomId(
          new CustomID('hub_manage:logsBackBtn', [
            interaction.user.id,
            hubInDb.id,
            type,
          ]).toString(),
        ),
      new ButtonBuilder()
        .setEmoji(emojis.delete)
        .setStyle(ButtonStyle.Danger)
        .setCustomId(
          new CustomID('hub_manage:logsDel', [interaction.user.id, hubInDb.id, type]).toString(),
        ),
    );

    const logChannel = hubInDb.logChannels?.[type];
    const embed = new EmbedBuilder()
      .setTitle(t({ phrase: 'hub.manage.logs.config.title', locale }, { type }))
      .setDescription(
        t({ phrase: 'hub.manage.logs.config.description', locale }, { arrow: emojis.arrow }),
      )
      .addFields(
        typeof logChannel === 'string'
          ? [
            {
              name: t({ phrase: 'hub.manage.logs.config.fields.channel', locale }),
              value: logChannel ? `<#${logChannel}>` : 'N/A',
            },
          ]
          : [
            {
              name: t({ phrase: 'hub.manage.logs.config.fields.channel', locale }),
              value: logChannel?.channelId ? `<#${logChannel.channelId}>` : 'N/A',
              inline: true,
            },
            {
              name: t({ phrase: 'hub.manage.logs.config.fields.role', locale }),
              value: logChannel?.roleId ? `<@&${logChannel.roleId}>` : 'N/A',
              inline: true,
            },
          ],
      )
      .setColor(Constants.Colors.invisible);

    const componentsToSend =
      type === 'reports' ? [channelSelect, roleSelect, buttons] : [channelSelect, buttons];

    await interaction.update({ embeds: [embed], components: componentsToSend });
  }

  private async handleAction(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    action: string,
    locale: supportedLocaleCodes,
  ) {
    switch (action) {
      case 'icon':
      case 'description':
      case 'banner':
        await this.showModal(interaction, hubInDb.id, action, locale);
        break;
      case 'visibility':
        await this.toggleVisibility(interaction, hubInDb, locale);
        break;
      case 'toggle_lock':
        await this.toggleLock(interaction, hubInDb);
        break;
      default:
        break;
    }
  }

  private async showModal(
    interaction: MessageComponentInteraction,
    hubId: string,
    type: 'icon' | 'banner' | 'description',
    locale: supportedLocaleCodes,
  ) {
    const modal = new ModalBuilder()
      .setCustomId(new CustomID(`hub_manage_modal:${type}`, [hubId]).toString())
      .setTitle(t({ phrase: `hub.manage.${type}.modal.title`, locale }));

    const inputField = new TextInputBuilder()
      .setLabel(t({ phrase: `hub.manage.${type}.modal.label`, locale }))
      .setStyle(type === 'description' ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setCustomId(type);

    if (type === 'description') {
      inputField.setMaxLength(1024);
    }
    else {
      inputField.setPlaceholder(t({ phrase: 'hub.manage.enterImgurUrl', locale }));
    }

    if (type === 'banner') {
      inputField.setRequired(false);
    }

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(inputField));

    await interaction.showModal(modal);
  }

  private async toggleVisibility(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    locale: supportedLocaleCodes,
  ) {
    const updatedHub = await db.hub.update({
      where: { id: hubInDb?.id },
      data: { private: !hubInDb?.private },
      include: { connections: true },
    });

    await interaction.reply({
      content: t(
        { phrase: 'hub.manage.visibility.success', locale },
        {
          emoji: updatedHub.private ? '🔒' : '🔓',
          visibility: updatedHub.private ? 'private' : 'public',
        },
      ),
      ephemeral: true,
    });

    await interaction.message.edit({ embeds: [await hubEmbed(updatedHub)] }).catch(() => null);
  }

  private async toggleLock(interaction: MessageComponentInteraction, hubInDb: Hub) {
    const updatedHub = await db.hub.update({
      where: { id: hubInDb?.id },
      data: { locked: !hubInDb?.locked },
      include: { connections: true },
    });

    const lockedStatus = updatedHub.locked ? 'locked' : 'unlocked';

    await this.replyEmbed(
      interaction,
      `${lockedStatus === 'locked' ? '🔒' : '🔓'} Hub chats are now ${lockedStatus}.`,
      { ephemeral: true },
    );

    await interaction.message.edit({ embeds: [await hubEmbed(updatedHub)] }).catch(() => null);

    await sendToHub(updatedHub.id, {
      embeds: [
        new InfoEmbed()
          .setTitle(`🛡️ Hub chats are now ${lockedStatus}.`)
          .setDescription(
            `${lockedStatus === 'locked' ? 'Only moderators can send messages.' : 'Everyone can send messages.'}`,
          ),
      ],
    });
  }

  private async updateLogChannel(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    type: keyof Prisma.HubLogChannelsCreateInput,
    channelId: string,
    locale: supportedLocaleCodes,
  ) {
    await setLogChannelFor(hubInDb.id, type, channelId);

    const embed = interaction.message.embeds[0].toJSON();
    const channelStr = this.channelMention(channelId);
    if (embed.fields?.at(0)) embed.fields[0].value = channelStr;
    await interaction.update({ embeds: [embed] });

    await interaction.followUp({
      embeds: [
        new InfoEmbed().setDescription(
          t(
            { phrase: 'hub.manage.logs.channelSuccess', locale },
            { emoji: emojis.yes, type, channel: channelStr },
          ),
        ),
      ],
      ephemeral: true,
    });
  }

  private async updateReportRole(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    type: keyof Prisma.HubLogChannelsCreateInput,
    role: Role | APIRole | undefined,
    locale: supportedLocaleCodes,
  ) {
    if (type === 'reports' && role?.id) {
      if (!hubInDb.logChannels?.reports?.channelId) {
        await interaction.reply({
          content: t(
            { phrase: 'hub.manage.logs.reportChannelFirst', locale },
            { emoji: emojis.no },
          ),
          ephemeral: true,
        });
        return;
      }

      await setReportRole(hubInDb, role.id);
    }

    const embed = interaction.message.embeds[0].toJSON();
    if (embed.fields?.at(1)) embed.fields[1].value = `${role || 'None'}`;
    await interaction.update({ embeds: [embed] });

    const successEmbed = new InfoEmbed().setDescription(
      t(
        { phrase: 'hub.manage.logs.roleSuccess', locale },
        { emoji: emojis.yes, type, role: `${role}` },
      ),
    );

    await interaction.followUp({ embeds: [successEmbed], ephemeral: true });
  }

  private async updateDescription(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const description = interaction.fields.getTextInputValue('description');
    await db.hub.update({
      where: { id: hubId },
      data: { description },
    });

    await interaction.reply({
      content: t({ phrase: 'hub.manage.description.changed', locale }),
      ephemeral: true,
    });
  }

  private async updateIcon(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    const newIcon = interaction.fields.getTextInputValue('icon');
    const iconUrl = await checkAndFetchImgurUrl(newIcon);

    if (!iconUrl) {
      await interaction.reply({
        content: t({ phrase: 'hub.invalidImgurUrl', locale }, { emoji: emojis.no }),
        ephemeral: true,
      });
      return;
    }

    await db.hub.update({
      where: { id: hubId },
      data: { iconUrl },
    });

    await interaction.reply({
      content: t({ phrase: 'hub.manage.icon.changed', locale }),
      ephemeral: true,
    });
  }

  private async updateBanner(
    interaction: ModalSubmitInteraction,
    hubId: string,
    locale: supportedLocaleCodes,
  ) {
    await interaction.deferReply({ ephemeral: true });

    const newBanner = interaction.fields.getTextInputValue('banner');

    if (!newBanner) {
      await db.hub.update({
        where: { id: hubId },
        data: { bannerUrl: { unset: true } },
      });

      await interaction.editReply(t({ phrase: 'hub.manage.banner.removed', locale }));
      return;
    }

    const bannerUrl = await checkAndFetchImgurUrl(newBanner);

    if (!bannerUrl) {
      await interaction.editReply(
        t({ phrase: 'hub.invalidImgurUrl', locale }, { emoji: emojis.no }),
      );
      return;
    }

    await db.hub.update({
      where: { id: hubId },
      data: { bannerUrl },
    });

    await interaction.editReply(emojis.yes + t({ phrase: 'hub.manage.banner.changed', locale }));
  }

  private async updateOriginalMessage(interaction: ModalSubmitInteraction, hubId: string) {
    const updatedHub = await db.hub.findFirst({
      where: { id: hubId },
      include: { connections: true },
    });

    if (updatedHub) {
      await interaction.message?.edit({ embeds: [await hubEmbed(updatedHub)] }).catch(() => null);
    }
  }

  private async showSettingsMenu(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    customId: ParsedCustomId,
  ) {
    const settingsManager = new HubSettingsManager(hubInDb.id, hubInDb.settings);

    const embed = settingsManager.getSettingsEmbed();
    const selects = buildSettingsMenu(
      settingsManager.getAllSettings(),
      hubInDb.id,
      customId.args[0],
    );

    await interaction.reply({ embeds: [embed], components: [selects], ephemeral: true });
  }

  private async showLogsMenu(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    customId: ParsedCustomId,
    locale: supportedLocaleCodes,
  ) {
    const embed = genLogInfoEmbed(hubInDb, locale);

    const selects = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(
          new CustomID()
            .setIdentifier('hub_manage', 'logsSelect')
            .addArgs(interaction.user.id)
            .addArgs(hubInDb.id)
            .toString(),
        )
        .setPlaceholder('Choose a log type to set a channel.')
        .addOptions([
          {
            label: t({ phrase: 'hub.manage.logs.reports.label', locale }),
            value: 'reports',
            description: t({ phrase: 'hub.manage.logs.reports.description', locale }),
            emoji: '📢',
          },
          {
            label: t({ phrase: 'hub.manage.logs.modLogs.label', locale }),
            value: 'modLogs',
            description: t({ phrase: 'hub.manage.logs.modLogs.description', locale }),
            emoji: '👮',
          },
          {
            label: t({ phrase: 'hub.manage.logs.profanity.label', locale }),
            value: 'profanity',
            description: t({ phrase: 'hub.manage.logs.profanity.description', locale }),
            emoji: '🤬',
          },
          {
            label: t({ phrase: 'hub.manage.logs.joinLeave.label', locale }),
            value: 'joinLeaves',
            description: t({ phrase: 'hub.manage.logs.joinLeave.description', locale }),
            emoji: '👋',
          },
        ]),
    );

    const msgToSend = { embeds: [embed], components: [selects], ephemeral: true };
    if (customId.suffix === 'logsBtn') await interaction.reply(msgToSend);
    else await interaction.update(msgToSend);
  }

  private async deleteLogChannel(
    interaction: MessageComponentInteraction,
    hubInDb: Hub,
    customId: ParsedCustomId,
    locale: supportedLocaleCodes,
  ) {
    const type = customId.args[2] as keyof Prisma.HubLogChannelsCreateInput;

    if (type === 'reports') {
      await removeReportsFrom(hubInDb.id);
    }
    else {
      const currentConfig = hubInDb.logChannels;
      if (currentConfig) {
        delete currentConfig[type];
      }

      await db.hub.update({
        where: { id: hubInDb.id },
        data: { logChannels: currentConfig ? { set: currentConfig } : { unset: true } },
      });
    }

    await this.replyEmbed(
      interaction,
      t({ phrase: 'hub.manage.logs.reset', locale }, { emoji: emojis.deleteDanger_icon, type }),
      { ephemeral: true },
    );
  }

  private async componentChecks(interaction: MessageComponentInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    if (customId.args[0] !== interaction.user.id) {
      const embed = new InfoEmbed().setDescription(
        t({ phrase: 'errors.notYourAction', locale }, { emoji: emojis.no }),
      );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return {};
    }

    const hubInDb = await db.hub.findFirst({
      where: { id: customId.args[1] },
      include: { connections: true },
    });

    if (!hubInDb) {
      const embed = new InfoEmbed().setDescription(
        t({ phrase: 'hub.notFound', locale }, { emoji: emojis.no }),
      );

      await interaction.reply({ embeds: [embed], ephemeral: true });
      return {};
    }

    return { hubInDb, customId, locale };
  }

  private async modalChecks(interaction: ModalSubmitInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId] = customId.args;
    const { userManager } = interaction.client;
    const locale = await userManager.getUserLocale(interaction.user.id);

    const hubInDb = await db.hub.findFirst({
      where: {
        id: hubId,
        OR: [
          { ownerId: interaction.user.id },
          { moderators: { some: { userId: interaction.user.id, position: 'manager' } } },
        ],
      },
      include: { connections: true },
    });

    if (!hubInDb) {
      await interaction.reply({
        content: t({ phrase: 'hub.notFound_mod', locale }, { emoji: emojis.no }),
        ephemeral: true,
      });
      return {};
    }

    return { hubInDb, customId, locale };
  }

  private channelMention(channelId: string | null | undefined) {
    if (!channelId) return emojis.no;
    return `<#${channelId}>`;
  }
}
