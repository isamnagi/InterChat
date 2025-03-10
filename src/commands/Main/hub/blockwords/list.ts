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
import { HubService } from '#src/services/HubService.js';
import {
  fetchHub,
  executeHubRoleChecksAndReply,
} from '#src/utils/hub/utils.js';
import { buildBlockWordListEmbed } from '#src/utils/moderation/blockWords.js';
import type { AutocompleteInteraction } from 'discord.js';

export default class HubBlockwordsListSubcommand extends BaseCommand {
  private readonly hubService = new HubService();

  constructor() {
    super({
      name: 'list',
      description: '📜 View all blocked word rules for a hub.',
      types: { slash: true, prefix: true },
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

    const blockWords = await hub.fetchBlockWords();

    if (!blockWords.length) {
      await ctx.replyEmbed('hub.blockwords.notFound', { flags: ['Ephemeral'] });
      return;
    }

    const embed = buildBlockWordListEmbed(blockWords, ctx.client);
    await ctx.reply({ embeds: [embed] });
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
}
