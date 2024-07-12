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
  // Check if the WatchedUser already exists
  const existingWatchedUser = await db.watched_users.findUnique({
    where: {
      target_user_id: targetUserId,
    },
    include: {
      watch_requests: true, // Include associated WatchRequests
    },
  });

  if (existingWatchedUser) {
    // Check if the watch request already exists
    // const existingRequest = existingWatchedUser.watch_requests.find(
    //   (request: DbWatchRequest) => request.caller_id === newWatchRequest.callerId,
    // );

    // WatchedUser already exists, update it
    return db.watched_users.update({
      where: {
        target_user_id: targetUserId,
      },
      data: {
        watch_requests: {
          createMany: {
            data: watchRequests.map(request => ({
              notification_method: request.notificationMethod,
              channel_id: request.channelId,
              caller_id: request.callerId,
            })),
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

  if (!watch) return;

  const { watchRequests } = watch;
  watchRequests.forEach(async (watchRequestObj: WatchRequest) => {
    const target = await message.client.users.fetch(watch.targetUserId) as User;
    if (watchRequestObj.notificationMethod === 'dm') {
      const caller = await message.client.users.fetch(watchRequestObj.callerId);
      if (caller) {
        caller.send(`Hey ${caller}, the user ${target} which you were watching has been active recently in ${message.channel}!`);
        await deleteWatchRequest(watch.targetUserId, caller.id);
      }
    } else if (watchRequestObj.notificationMethod === 'channel') {
      const tripsitGuild = await message.client.guilds.fetch(env.DISCORD_GUILD_ID);
      if (watchRequestObj.channelId) {
        const notificationChannel = await tripsitGuild.channels.fetch(watchRequestObj.channelId as string) as TextChannel;
        const caller = await message.client.users.fetch(watchRequestObj.callerId) as User;
        notificationChannel.send(`Hey ${caller}, the user ${target} which you were watching has been active recently in ${message.channel}!`);
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
  log.info(F, `watched users: ${JSON.stringify(watchedUsers)}`);
  // If someone is already watching this user...
  if (watch) {
    const { watchRequests } = watch;
    watchRequests.forEach(async (watchRequestObj: WatchRequest) => {
      if (callerId === watchRequestObj.callerId) {
        log.info(F, `callerId: ${callerId} - watchRequest callerId: ${watchRequestObj.callerId}`);
        return false;
      }
      watchRequests.push({
        notificationMethod,
        channelId: alertChannel ? alertChannel.id : null,
        callerId,
      });
      watchedUsers[target.id].watchRequests = watchRequests as WatchRequest[];
      await dbAddOrUpdateWatchedUser(target.id, watchRequests, callerId);
      return true;
    });
    // No one is currently watching this user
  } else {
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
    return true;
  }
  log.info(F, 'got to the final false in executeWatch');
  return false;
}
