import {
  deleteConnection,
  deleteConnections,
  getHubConnections,
} from '#utils/ConnectedListUtils.js';
import db from '#utils/Db.js';
import Logger from '#utils/Logger.js';
import { deleteMsgsFromDb, checkIfStaff } from '#utils/Utils.js';
import type { Hub } from '@prisma/client';
import { type WebhookMessageCreateOptions, WebhookClient } from 'discord.js';

/**
 * Sends a message to all connections in a hub's network.
 * @param hubId The ID of the hub to send the message to.
 * @param message The message to send. Can be a string or a MessageCreateOptions object.
 * @returns A array of the responses from each connection's webhook.
 */
export const sendToHub = async (hubId: string, message: string | WebhookMessageCreateOptions) => {
  const connections = await getHubConnections(hubId);

  connections?.forEach(async ({ channelId, webhookURL, parentId, connected }) => {
    if (!connected) return;

    const threadId = parentId ? channelId : undefined;
    const payload =
      typeof message === 'string' ? { content: message, threadId } : { ...message, threadId };

    try {
      const webhook = new WebhookClient({ url: webhookURL });
      await webhook.send(payload);
    }
    catch (e) {
      const validErrors = [
        'Unknown Webhook',
        'Invalid Webhook Token',
        'The provided webhook URL is not valid.',
      ];

      if (validErrors.includes(e.message)) await deleteConnection({ channelId });

      e.message = `For Connection: ${channelId} ${e.message}`;
      Logger.error(e);
    }
  });
};

export const deleteHubs = async (ids: string[]) => {
  // delete all relations first and then delete the hub
  await deleteConnections({ hubId: { in: ids } });
  await db.hubInvite.deleteMany({ where: { hubId: { in: ids } } });
  await db.originalMessages
    .findMany({ where: { hubId: { in: ids } }, include: { broadcastMsgs: true } })
    .then((m) =>
      deleteMsgsFromDb(
        m.map(({ broadcastMsgs }) => broadcastMsgs.map(({ messageId }) => messageId)).flat(),
      ),
    );

  // finally, delete the hub
  await db.hub.deleteMany({ where: { id: { in: ids } } });
};
export const fetchHub = async (id: string) => await db.hub.findFirst({ where: { id } });
export const isHubMod = (userId: string, hub: Hub) =>
  Boolean(hub.ownerId === userId || hub.moderators.find((mod) => mod.userId === userId));

export const isStaffOrHubMod = (userId: string, hub: Hub) =>
  checkIfStaff(userId) || isHubMod(userId, hub);
