import {
  TextChannel,
  Message,
  User,
} from 'discord.js';

const F = f(__filename);

interface WatchedUser {
  targetUserId: string;
  watchRequests: WatchRequest[];
}

interface WatchRequest {
  notificationMethod: string;
  channelId: string | null;
  callerId: string;
}

// Utility type for database WatchRequest
type DbWatchRequest = {
  id: number;
  notification_method: string;
  channel_id: string | null;
  caller_id: string;
  watched_user_id: string;
  created_by: string;
};

export const watchedUsers: { [key: string]: WatchedUser } = {};

export async function dbAddOrUpdateWatchedUser(targetUserId: string, watchRequests: WatchRequest[], createdBy: string) {
  // Get the WatchedUser if it already exists
  const existingWatchedUser = await db.watched_users.findUnique({
    where: {
      target_user_id: targetUserId,
    },
  });

  if (existingWatchedUser) {
    // Get the latest watch request
    const latestRequest = watchRequests[watchRequests.length - 1];

    // WatchedUser already exists, update it
    return db.watched_users.update({
      where: {
        target_user_id: targetUserId,
      },
      data: {
        watch_requests: {
          create: {
            notification_method: latestRequest.notificationMethod,
            channel_id: latestRequest.channelId,
            caller_id: latestRequest.callerId,
          },
        },
      },
    });
  }
  // WatchedUser does not exist, create a new one
  return db.watched_users.create({
    data: {
      target_user_id: targetUserId,
      watch_requests: {
        createMany: {
          data: watchRequests.map(request => ({
            notification_method: request.notificationMethod,
            channel_id: request.channelId,
            caller_id: request.callerId,
          })),
        },
      },
      created_by: createdBy,
    },
  });
}

export async function dbDeleteWatchRequestOrWatchedUser(targetUserId: string, callerId: string): Promise<void> {
  const watchedUser = await db.watched_users.findUnique({
    where: { target_user_id: targetUserId },
    include: { watch_requests: true },
  });

  if (!watchedUser) {
    log.info(F, `Watched user with ID ${targetUserId} does not exist.`);
    return;
  }

  const watchRequests = watchedUser.watch_requests as DbWatchRequest[];

  // Delete only the watch request related to the caller
  const requestToDelete = watchRequests.find(request => request.caller_id === callerId);
  if (requestToDelete) {
    await db.watch_request.delete({
      where: { id: requestToDelete.id },
    });
  } else {
    log.info(F, `No watch request found for caller ${callerId}.`);
  }
  if (watchRequests.length <= 1) {
    await db.watched_users.delete({
      where: { target_user_id: targetUserId },
    });
  }
}

export async function deleteWatchRequest(targetUserId: string, callerId: string): Promise<Boolean> {
  const watch = watchedUsers[targetUserId];

  if (!watch) {
    return false; // Watched user not found
  }

  const { watchRequests } = watch;

  // Find the index of the watchRequest to delete
  const indexToDelete = watchRequests.findIndex(watchRequest => watchRequest.callerId === callerId);

  if (indexToDelete === -1) {
    return false; // WatchRequest with callerId not found
  }

  // Delete the watchRequest from the array
  watchRequests.splice(indexToDelete, 1);

  // If there are no more watch requests, delete the entire watchedUsers entry
  if (watchRequests.length === 0) {
    delete watchedUsers[targetUserId];
  }

  await dbDeleteWatchRequestOrWatchedUser(targetUserId, callerId);

  return true; // Successfully deleted the watchRequest
}

export async function nightsWatch(message: Message) {
  const watch = watchedUsers[message.author.id];

  if (!watch || !message.guild) return;

  const { watchRequests } = watch;
  watchRequests.forEach(async (watchRequestObj: WatchRequest) => {
    const target = await message.client.users.fetch(watch.targetUserId) as User;
    if (watchRequestObj.notificationMethod === 'dm') {
      const caller = await message.client.users.fetch(watchRequestObj.callerId);
      if (caller) {
        caller.send(`Hey ${caller}, the user ${target} which you were watching has been active recently in ${message.channel}. [Here's a direct link.](https://discord.com/channels/${message.guild!.id}/${message.channel.id}/${message.id})`);
        await deleteWatchRequest(watch.targetUserId, caller.id);
      }
    } else if (watchRequestObj.notificationMethod === 'channel') {
      const tripsitGuild = await message.client.guilds.fetch(env.DISCORD_GUILD_ID);
      if (watchRequestObj.channelId) {
        const notificationChannel = await tripsitGuild.channels.fetch(watchRequestObj.channelId as string) as TextChannel;
        const caller = await message.client.users.fetch(watchRequestObj.callerId) as User;
        notificationChannel.send(`Hey ${caller}, the user ${target} which you were watching has been active recently in ${message.channel}. [Here's a direct link.](https://discord.com/channels/${message.guild!.id}/${message.channel.id}/${message.id})`);
        await deleteWatchRequest(watch.targetUserId, caller.id);
      }
    }
  });
}

export async function executeWatch(
  target: User,
  notificationMethod: string,
  callerId: string,
  alertChannel: TextChannel | null = null,
): Promise<Boolean> {
  const watch = watchedUsers[target.id] as WatchedUser;
  // If someone is already watching this user...
  if (watch) {
    const { watchRequests } = watch;
    log.info(F, `Existing watch requests length: ${watchRequests.length}`);

    // Check for existing request
    for (const watchRequestObj of watchRequests) {
      if (callerId === watchRequestObj.callerId) {
        log.info(F, `Duplicate watch request found for callerId: ${callerId}`);
        return false;
      }
    }

    // Add the new watch request
    watchRequests.push({
      notificationMethod,
      channelId: alertChannel ? alertChannel.id : null,
      callerId,
    });
    watchedUsers[target.id].watchRequests = watchRequests as WatchRequest[];
    await dbAddOrUpdateWatchedUser(target.id, watchRequests, callerId);
    log.info(F, `New watch request added for callerId: ${callerId}`);
    return true;
  }
  // No one is currently watching this user
  const newWatchRequests = [{
    notificationMethod,
    channelId: alertChannel ? alertChannel.id : null,
    callerId,
  }];

  watchedUsers[target.id] = {
    targetUserId: target.id,
    watchRequests: newWatchRequests,
  } as WatchedUser;
  await dbAddOrUpdateWatchedUser(target.id, newWatchRequests, callerId);
  log.info(F, `New watched user created with initial watch request for callerId: ${callerId}`);
  return true;
}
