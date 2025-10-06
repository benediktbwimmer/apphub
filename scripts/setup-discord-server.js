#!/usr/bin/env node
/*
 * Script to configure the Osiris AppHub Discord server for OSS collaboration.
 * Usage: DISCORD_BOT_TOKEN=your_token node scripts/setup-discord-server.js
 */

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

const guildName = process.env.DISCORD_GUILD_NAME || 'Osiris AppHub';
const apiBase = 'https://discord.com/api/v10';

const PERMISSIONS = {
  ADMINISTRATOR: 8n,
  MANAGE_CHANNELS: 16n,
  MANAGE_GUILD: 32n,
  SEND_MESSAGES: 2048n,
  MANAGE_MESSAGES: 8192n,
  CREATE_PUBLIC_THREADS: 34359738368n,
  CREATE_PRIVATE_THREADS: 68719476736n,
  SEND_MESSAGES_IN_THREADS: 274877906944n,
  MANAGE_THREADS: 17179869184n,
  MANAGE_ROLES: 268435456n,
  MANAGE_WEBHOOKS: 536870912n,
  USE_APPLICATION_COMMANDS: 2147483648n
};

function combinePermissions(keys) {
  return keys.reduce((total, key) => total | (PERMISSIONS[key] ?? 0n), 0n).toString();
}

async function discordRequest(path, options = {}, attempt = 0) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json'
    },
    ...options
  });

  if (response.status === 204) {
    return null;
  }

  if (response.status === 429) {
    const data = await response.json();
    const retryAfter = data.retry_after ?? 1;
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    if (attempt > 5) {
      throw new Error(`Rate limited too many times on ${path}`);
    }
    return discordRequest(path, options, attempt + 1);
  }

  if (!response.ok) {
    const data = await response.text();
    throw new Error(`Discord API ${response.status} ${response.statusText} on ${path}: ${data}`);
  }

  return response.json();
}

async function findGuildByName(name) {
  const guilds = await discordRequest('/users/@me/guilds', { method: 'GET' });
  const guild = guilds.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
  if (!guild) {
    throw new Error(`Bot is not a member of a guild named "${name}".`);
  }
  return guild;
}

async function ensureRoles(guildId) {
  const desiredRoles = [
    {
      name: 'Maintainer',
      permissions: combinePermissions(['ADMINISTRATOR']),
      color: 0xff7283,
      hoist: true,
      mentionable: true
    },
    {
      name: 'Core Team',
      permissions: combinePermissions([
        'MANAGE_CHANNELS',
        'MANAGE_THREADS',
        'MANAGE_MESSAGES',
        'CREATE_PUBLIC_THREADS',
        'CREATE_PRIVATE_THREADS',
        'SEND_MESSAGES_IN_THREADS',
        'USE_APPLICATION_COMMANDS'
      ]),
      color: 0x5865f2,
      hoist: true,
      mentionable: true
    },
    {
      name: 'Contributor',
      permissions: combinePermissions([
        'SEND_MESSAGES',
        'CREATE_PUBLIC_THREADS',
        'CREATE_PRIVATE_THREADS',
        'SEND_MESSAGES_IN_THREADS'
      ]),
      color: 0x57f287,
      mentionable: true
    },
    {
      name: 'Community',
      permissions: '0',
      color: 0xfee75c,
      mentionable: true
    },
    {
      name: 'Bots',
      permissions: combinePermissions([
        'SEND_MESSAGES',
        'MANAGE_MESSAGES',
        'USE_APPLICATION_COMMANDS'
      ]),
      color: 0x99aab5,
      mentionable: true
    }
  ];

  const existingRoles = await discordRequest(`/guilds/${guildId}/roles`, { method: 'GET' });
  const rolesByName = new Map(existingRoles.map((role) => [role.name.toLowerCase(), role]));

  const results = {};
  for (const config of desiredRoles) {
    const existing = rolesByName.get(config.name.toLowerCase());
    if (!existing) {
      const created = await discordRequest(`/guilds/${guildId}/roles`, {
        method: 'POST',
        body: JSON.stringify(config)
      });
      console.log(`Created role: ${config.name}`);
      results[config.name] = created;
    } else {
      const needsUpdate =
        existing.permissions !== config.permissions ||
        existing.color !== config.color ||
        Boolean(existing.hoist) !== Boolean(config.hoist) ||
        Boolean(existing.mentionable) !== Boolean(config.mentionable);
      if (needsUpdate) {
        await discordRequest(`/guilds/${guildId}/roles/${existing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(config)
        });
        console.log(`Updated role: ${config.name}`);
      }
      results[config.name] = existing;
    }
  }

  return results;
}

function buildReadOnlyOverwrites(guildId, maintainerRoleId, coreTeamRoleId) {
  const denyValue = combinePermissions([
    'SEND_MESSAGES',
    'CREATE_PUBLIC_THREADS',
    'CREATE_PRIVATE_THREADS',
    'SEND_MESSAGES_IN_THREADS'
  ]);
  const allowValue = combinePermissions([
    'SEND_MESSAGES',
    'CREATE_PUBLIC_THREADS',
    'CREATE_PRIVATE_THREADS',
    'SEND_MESSAGES_IN_THREADS',
    'MANAGE_MESSAGES'
  ]);

  const overwrites = [
    { id: guildId, type: 0, deny: denyValue }
  ];
  if (maintainerRoleId) {
    overwrites.push({ id: maintainerRoleId, type: 0, allow: allowValue });
  }
  if (coreTeamRoleId) {
    overwrites.push({ id: coreTeamRoleId, type: 0, allow: allowValue });
  }
  return overwrites;
}

async function ensureCategoriesAndChannels(guildId, roles) {
  const existingChannels = await discordRequest(`/guilds/${guildId}/channels`, { method: 'GET' });
  const channelByName = new Map(
    existingChannels.map((channel) => [`${channel.type}:${channel.name.toLowerCase()}`, channel])
  );

  const categories = [
    {
      name: 'Info',
      channels: [
        { name: 'welcome', type: 0, readOnly: true },
        { name: 'announcements', type: 0, readOnly: true },
        { name: 'changelog', type: 0, readOnly: true },
        { name: 'release-notes', type: 0, readOnly: true }
      ]
    },
    {
      name: 'Development',
      channels: [
        { name: 'general-dev', type: 0 },
        { name: 'frontend', type: 0 },
        { name: 'services', type: 0 },
        { name: 'infra', type: 0 },
        { name: 'testing', type: 0 }
      ]
    },
    {
      name: 'Community',
      channels: [
        { name: 'introductions', type: 0 },
        { name: 'support', type: 0 },
        { name: 'showcase', type: 0 }
      ]
    },
    {
      name: 'Voice',
      channels: [
        { name: 'Standups', type: 2 },
        { name: 'Pairing', type: 2 }
      ]
    }
  ];

  for (const categoryConfig of categories) {
    const categoryKey = `4:${categoryConfig.name.toLowerCase()}`;
    let category = channelByName.get(categoryKey);
    if (!category) {
      category = await discordRequest(`/guilds/${guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          name: categoryConfig.name,
          type: 4
        })
      });
      console.log(`Created category: ${categoryConfig.name}`);
      channelByName.set(categoryKey, category);
    }

    for (const channelConfig of categoryConfig.channels) {
      const key = `${channelConfig.type}:${channelConfig.name.toLowerCase()}`;
      let channel = channelByName.get(key);
      const body = {
        name: channelConfig.name,
        type: channelConfig.type,
        parent_id: category.id
      };

      if (channelConfig.type === 0 && channelConfig.readOnly) {
        body.permission_overwrites = buildReadOnlyOverwrites(
          guildId,
          roles['Maintainer']?.id,
          roles['Core Team']?.id
        );
      }

      if (!channel) {
        channel = await discordRequest(`/guilds/${guildId}/channels`, {
          method: 'POST',
          body: JSON.stringify(body)
        });
        console.log(`Created channel: #${channelConfig.name}`);
        channelByName.set(key, channel);
      } else {
        const patchBody = {
          name: channelConfig.name,
          parent_id: category.id
        };
        if (channelConfig.type === 0 && channelConfig.readOnly) {
          patchBody.permission_overwrites = buildReadOnlyOverwrites(
            guildId,
            roles['Maintainer']?.id,
            roles['Core Team']?.id
          );
        }
        await discordRequest(`/channels/${channel.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patchBody)
        });
        console.log(`Updated channel: #${channelConfig.name}`);
      }
    }
  }
}

(async function main() {
  try {
    console.log(`Configuring Discord server "${guildName}"...`);
    const guild = await findGuildByName(guildName);
    const roles = await ensureRoles(guild.id);
    await ensureCategoriesAndChannels(guild.id, roles);
    console.log('Discord server setup completed.');
  } catch (error) {
    console.error('Failed to configure Discord server:', error);
    process.exit(1);
  }
})();
