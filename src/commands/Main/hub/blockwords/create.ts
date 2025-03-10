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
  buildBlockedWordsBtns,
  buildBlockWordModal,
  buildBWRuleEmbed,
  sanitizeWords,
} from '#src/utils/moderation/blockWords.js';
import { fetchUserLocale } from '#src/utils/Utils.js';
import type {
  AutocompleteInteraction,
  ModalSubmitInteraction,
} from 'discord.js';

export default class HubBlockwordsCreateSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'create',
      types: { slash: true, prefix: true },
      description: '🧱 Add a new block word rule to your hub.',
      options: [hubOption],
    });
  }

  public async execute(ctx: Context) {
    const hubName = ctx.options.getString('hub') ?? undefined;

    const hub = await fetchHub({ name: hubName });
    if (
      !hub ||
			!(await executeHubRoleChecksAndReply(hub, ctx, {
			  checkIfManager: true,
			}))
    ) return;

    const modal = buildBlockWordModal(hub.id);
    await ctx.showModal(modal);
  }

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const hubs = await HubCommand.getModeratedHubs(
      interaction.options.getFocused(),
      interaction.user.id,
      this.hubService,
    );

    await interaction.respond(
      hubs.map(({ data }) => ({ name: data.name, value: data.name })),
    );
  }

  @RegisterInteractionHandler('blockwordsModal')
  async handleModals(interaction: ModalSubmitInteraction) {
    const customId = CustomID.parseCustomId(interaction.customId);
    const [hubId, ruleId] = customId.args as [string, string?];

    const hub = await fetchHub({ id: hubId });
    if (!hub) return;

    const locale = await fetchUserLocale(interaction.user.id);

    await interaction.reply({
      content: t('hub.blockwords.validating', locale, {
        emoji: getEmoji('loading', interaction.client),
      }),
      flags: ['Ephemeral'],
    });

    const name = interaction.fields.getTextInputValue('name');
    const newWords = sanitizeWords(
      interaction.fields.getTextInputValue('words'),
    );

    const emojiArg = { emoji: getEmoji('x_icon', interaction.client) } as const;

    // new rule
    if (!ruleId) {
      if ((await hub.fetchBlockWords()).length >= 2) {
        await interaction.editReply(
          t('hub.blockwords.maxRules', locale, {
            emoji: getEmoji('x_icon', interaction.client),
          }),
        );
        return;
      }

      const rule = await db.blockWord.create({
        data: { hubId, name, createdBy: interaction.user.id, words: newWords },
      });

      const embed = buildBWRuleEmbed(rule, interaction.client);
      const buttons = buildBlockedWordsBtns(hub.id, rule.id);
      await interaction.editReply({
        content: t('hub.blockwords.created', locale, emojiArg),
        embeds: [embed],
        components: [buttons],
      });
    }
    // remove rule
    else if (newWords.length === 0) {
      await db.blockWord.delete({ where: { id: ruleId } });
      await interaction.editReply(
        t('hub.blockwords.deleted', locale, emojiArg),
      );
    }

    // update rule
    else {
      await db.blockWord.update({
        where: { id: ruleId },
        data: { words: newWords, name },
      });

      await interaction.editReply(
        t('hub.blockwords.updated', locale, emojiArg),
      );
    }
  }
}
