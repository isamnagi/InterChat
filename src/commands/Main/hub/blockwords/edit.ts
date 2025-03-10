/*
 * Copyright (C) 2025 InterChat
 *
 * InterChat is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * InterChat is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with InterChat.  If not, see <https://www.gnu.org/licenses/>.
 */

import HubCommand, { hubOption } from '#src/commands/Main/hub/index.js';
import BaseCommand from '#src/core/BaseCommand.js';
import type Context from '#src/core/CommandContext/Context.js';
import { RegisterInteractionHandler } from '#src/decorators/RegisterInteractionHandler.js';
import { HubService } from '#src/services/HubService.js';
import { CustomID } from '#src/utils/CustomID.js';
import db from '#src/utils/Db.js';
import { getEmoji } from '#src/utils/EmojiUtils.js';
import {
  fetchHub,
  executeHubRoleChecksAndReply,
} from '#src/utils/hub/utils.js';
import { t } from '#src/utils/Locale.js';
import {
  ACTION_LABELS,
  buildBlockedWordsBtns,
  buildBlockWordActionsSelect,
  buildBlockWordModal,
  buildBWRuleEmbed,
} from '#src/utils/moderation/blockWords.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import type { BlockWordAction } from '@prisma/client';
import {
  ApplicationCommandOptionType,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';

export async function blockwordRuleAndHubAutocomplete(
  interaction: AutocompleteInteraction,
  hubService: HubService,
) {
  const hubOpt = interaction.options.get('hub');

  if (hubOpt?.focused) {
    const hubs = await HubCommand.getModeratedHubs(
      interaction.options.getFocused(),
      interaction.user.id,
      hubService,
    );

    await interaction.respond(
      hubs.map(({ data }) => ({ name: data.name, value: data.name })),
    );
  }

  const choices = await getBlockWordRules(interaction);
  await interaction.respond(choices ?? []);
}

async function getBlockWordRules(interaction: AutocompleteInteraction) {
  const focused = interaction.options.getFocused(true);
  const hubName = interaction.options.getString('hub');

  if (focused.name === 'rule') {
    if (!hubName) return [{ name: 'Please select a hub first.', value: '' }];

    const rules = await db.blockWord.findMany({
      where: { hub: { name: hubName } },
      select: { id: true, name: true },
    });

    return rules.map((rule) => ({ name: rule.name, value: rule.name }));
  }
  return null;
}

export default class HubBlockwordsEditSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'edit',
      description: '📝 Edit an existing blocked word rule in your hub.',
      types: { slash: true, prefix: true },
      options: [
        hubOption,
        {
          type: ApplicationCommandOptionType.String,
          name: 'rule',
          description: 'The name of the rule you want to edit.',
          required: true,
          autocomplete: true,
        },
      ],
    });
  }

  public async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub') ?? undefined;
    const hub = await fetchHub({ name: hubName ?? undefined });
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, ctx, {
			  checkIfManager: true,
			}))
    ) return;

    const blockWords = await hub.fetchBlockWords();
    const ruleName = ctx.options.getString('rule');
    const rule = blockWords.find((r) => r.name === ruleName);

    if (!rule) {
      await ctx.replyEmbed('hub.blockwords.notFound', { flags: ['Ephemeral'] });
      return;
    }

    const embed = buildBWRuleEmbed(rule, ctx.client);
    const buttons = buildBlockedWordsBtns(hub.id, rule.id);
    await ctx.reply({ embeds: [embed], components: [buttons] });
  }

  async autocomplete(interaction: AutocompleteInteraction) {
    await blockwordRuleAndHubAutocomplete(interaction, this.hubService);
  }

  @RegisterInteractionHandler('blockwordsButton', 'editWords')
  async handleEditButtons(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;

    const hub = await fetchHub({ id: hubId });

    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, interaction, {
			  checkIfManager: true,
			}))
    ) return;

    const blockWords = await hub.fetchBlockWords();
    const presetRule = blockWords.find((r) => r.id === ruleId);

    if (!presetRule) {
      await interaction.reply({
        content: t(
          'hub.blockwords.notFound',
          await fetchUserLocale(interaction.user.id),
          { emoji: getEmoji('x_icon', interaction.client) },
        ),
        flags: ['Ephemeral'],
      });
      return;
    }

    const modal = buildBlockWordModal(hub.id, { presetRule });
    await interaction.showModal(modal);
  }

  @RegisterInteractionHandler('blockwordsButton', 'configActions')
  async handleConfigureActions(interaction: ButtonInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args;

    const hub = await fetchHub({ id: hubId });
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, interaction, {
			  checkIfManager: true,
			}))
    ) return;

    const locale = await fetchUserLocale(interaction.user.id);

    const rule = (await hub.fetchBlockWords()).find((r) => r.id === ruleId);
    if (!rule) {
      await interaction.reply({
        content: t('hub.blockwords.notFound', locale, {
          emoji: getEmoji('x_icon', interaction.client),
        }),
        flags: ['Ephemeral'],
      });
      return;
    }

    const selectMenu = buildBlockWordActionsSelect(
      hubId,
      ruleId,
      rule.actions || [],
    );

    await interaction.reply({
      content: t('hub.blockwords.configure', locale, { rule: rule.name }),
      components: [selectMenu],
      flags: ['Ephemeral'],
    });
  }

  @RegisterInteractionHandler('blockwordsSelect', 'actions')
  async handleActionSelection(interaction: StringSelectMenuInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const ruleId = customId.args[1];
    const selectedActions = interaction.values as BlockWordAction[];

    await db.blockWord.update({
      where: { id: ruleId },
      data: { actions: selectedActions },
    });

    const actionLabels = selectedActions
      .map((action) => ACTION_LABELS[action])
      .join(', ');

    await interaction.update({
      content: t(
        'hub.blockwords.actionsUpdated',
        await fetchUserLocale(interaction.user.id),
        {
          emoji: getEmoji('tick_icon', interaction.client),
          actions: actionLabels,
        },
      ),
      components: [],
    });
  }
}
