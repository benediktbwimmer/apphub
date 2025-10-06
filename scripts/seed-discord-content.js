#!/usr/bin/env node
/*
 * Seed the Osiris AppHub Discord server with baseline onboarding messages.
 * Usage: DISCORD_BOT_TOKEN=... node scripts/seed-discord-content.js
 */

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('DISCORD_BOT_TOKEN environment variable is required.');
  process.exit(1);
}

const guildName = process.env.DISCORD_GUILD_NAME || 'Osiris AppHub';
const apiBase = 'https://discord.com/api/v10';

const CHANNEL_CONTENT = {
  welcome: [
    `👋 **Welcome to Osiris AppHub!**\n\nThanks for joining the open-source community that powers every part of AppHub. Kick things off with these steps:\n\n• Review roadmap updates in {{channel:announcements}}.\n• Say hello in {{channel:introductions}} and share what you want to work on.\n• Looking for a task? Browse GitHub issues and sync with maintainers in {{channel:general-dev}}.\n\n**Helpful links**\n• Repo: https://github.com/benediktbwimmer/apphub\n• Docs: https://github.com/benediktbwimmer/apphub/tree/main/docs\n• Local dev: run npm install, then npm run dev.\n\nNeed a hand? Post in {{channel:support}} and a maintainer will follow up.`
  ],
  announcements: [
    `📢 **Announcements Channel Guidelines**\n\nThis space hosts project-wide updates: roadmap milestones, community calls, infra downtime, and major hiring or partnership notes.\n\nMaintainers: when you post, lead with a bold headline, include GitHub links, and tag specific workspaces (e.g., {{channel:frontend}}) if there is follow up discussion. Keep chatter in threads so the main feed stays high-signal.`
  ],
  changelog: [
    `🛠️ **Weekly Changelog Thread**\n\nDrop summaries of merged pull requests, notable fixes, and dependency bumps here. A helpful format is:\n\n**Week of YYYY-MM-DD**\n- \[feat] Short description (link to PR)\n- \[fix] Notable bug fix\n- Docs or release notes references\n\nThis history powers release notes and keeps contributors in sync.`
  ],
  'release-notes': [
    `🚀 **Release Notes Staging**\n\nUse this channel to draft the copy that goes into GitHub releases or the marketing newsletter. Before publishing:\n\n1. Link to the changelog items or PRs you are referencing.\n2. Summarize any migrations, configuration tweaks, or downtime expectations.\n3. Tag the right maintainers for review.\n\nOnce approved, move the text to GitHub Releases and drop a link back here.`
  ],
  'general-dev': [
    `👩‍💻 **Development Coordination**\n\nPlanning an issue or opening a PR? Share it here so others can hop in. Best practices:\n\n• Post a quick blurb with a GitHub link when you start work.\n• Use threads for design proposals and code review follow-ups.\n• Call out testing or environment steps so QA knows how to validate.\n\nFor topic-specific dives, jump into {{channel:frontend}}, {{channel:services}}, {{channel:infra}}, or {{channel:testing}}.`
  ],
  general: [
    `👋 This channel is for lightweight chatter and quick questions. For focused development coordination head to {{channel:general-dev}}, and for help requests use {{channel:support}}. New here? Say hi in {{channel:introductions}}!`
  ],
  frontend: [
    `🎨 **Frontend Crew HQ**\n\nDiscuss the Vite + React app in {{channel:frontend}}. Share component APIs, screenshot diffs, and accessibility notes. Handy commands:\n\n• Dev server: npm run dev --workspace @apphub/frontend\n• Tests: npm test --workspace @apphub/frontend\n• Lint: npm run lint --workspace @apphub/frontend\n\nRemember to post UI gifs or Storybook links when you tweak AppHub experiences.`
  ],
  services: [
    `🧠 **Core Services Discussion**\n\nUse this space for API layer, workers, and module runtime changes. Keep teammates unblocked by sharing:\n\n• Schema or queue changes before they land\n• Perf regressions or logs that need attention\n• Links to relevant docs in services/ or packages/\n\nNeed database or Redis help? Loop in infra folks via {{channel:infra}}.`
  ],
  infra: [
    `🏗️ **Infra & Operations**\n\nCoordinate deployment scripts, observability, and environments here. Useful threads include:\n\n• Docker image or Terraform updates\n• Monitoring alerts for AppHub deployments\n• Pre-merge checklists for migrations\n\nInfra changes that affect developers should always be cross-posted to {{channel:announcements}}.`
  ],
  testing: [
    `✅ **Testing & QA**\n\nTrack the state of automated suites and manual validation. Share:\n\n• Vitest or Node test failures with logs\n• Plans for integration tests under tests/\n• Manual walkthrough notes for the showcase environments\n\nBefore merging major features, drop your validation checklist here so others can replicate it.`
  ],
  support: [
    `🙋 **Support Requests**\n\nAsk for help with setup, bugs, or deployment snafus. When you open a request, include:\n\n• What you were doing and the expected outcome\n• Logs, screenshots, or stack traces\n• GitHub issue links if one exists\n\nA maintainer will follow up and move confirmed bugs into GitHub. Urgent production issues should be escalated in {{channel:announcements}} once resolved.`
  ],
  introductions: [
    `👋 **Introduce Yourself**\n\nLet the community know who you are! Helpful prompts:\n\n• What brings you to Osiris AppHub?\n• What tools or services do you want to learn?\n• Link your GitHub or recent project.\n\nMaintainers keep an eye on this channel so they can suggest good first issues.`
  ],
  showcase: [
    `🌟 **Show & Tell**\n\nShare screenshots, Loom demos, or recordings of what you built with AppHub. For each post, include:\n\n• What problem you solved\n• The modules or services involved\n• Links to PRs or docs\n\nWe spotlight the best demos in {{channel:announcements}} and future community calls.`
  ]
};

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
      throw new Error(`Rate limited on ${path}`);
    }
    return discordRequest(path, options, attempt + 1);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord API ${response.status} ${response.statusText} on ${path}: ${text}`);
  }

  return response.json();
}

function injectChannelMentions(content, channelMap) {
  return content.replace(/\{\{channel:([^}]+)\}\}/g, (_, name) => {
    const channel = channelMap.get(name.toLowerCase());
    if (!channel) {
      console.warn(`Channel placeholder {{channel:${name}}} missing; leaving as plain text.`);
      return `#${name}`;
    }
    return `<#${channel.id}>`;
  });
}

async function ensureMessages(guildId, botId, channelMap) {
  for (const [name, messages] of Object.entries(CHANNEL_CONTENT)) {
    const channel = channelMap.get(name.toLowerCase());
    if (!channel) {
      console.warn(`Skipping channel "${name}"; not found in guild.`);
      continue;
    }
    for (let index = 0; index < messages.length; index += 1) {
      const marker = `[seeded-by-apphub-assistant:${name}-${index + 1}]`;
      const rendered = injectChannelMentions(messages[index], channelMap);
      const existing = await discordRequest(`/channels/${channel.id}/messages?limit=50`, {
        method: 'GET'
      });
      const existingMessage = Array.isArray(existing)
        ? existing.find((message) => message.author?.id === botId && message.content.includes(marker))
        : null;
      const payload = {
        content: `${rendered}

${marker}`,
        allowed_mentions: { parse: [] }
      };
      if (existingMessage) {
        await discordRequest(`/channels/${channel.id}/messages/${existingMessage.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        });
        console.log(`Updated message ${index + 1} in #${channel.name}`);
        continue;
      }
      await discordRequest(`/channels/${channel.id}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      console.log(`Seeded message ${index + 1} in #${channel.name}`);
    }
  }
}

(async function main() {
  try {
    console.log(`Seeding Discord server "${guildName}" with baseline content...`);
    const guilds = await discordRequest('/users/@me/guilds', { method: 'GET' });
    const guild = guilds.find((entry) => entry.name.toLowerCase() === guildName.toLowerCase());
    if (!guild) {
      throw new Error(`Bot is not a member of a guild named "${guildName}".`);
    }

    const botUser = await discordRequest('/users/@me', { method: 'GET' });
    const channels = await discordRequest(`/guilds/${guild.id}/channels`, { method: 'GET' });
    const channelMap = new Map();
    channels
      .filter((channel) => channel.type === 0)
      .forEach((channel) => channelMap.set(channel.name.toLowerCase(), channel));

    await ensureMessages(guild.id, botUser.id, channelMap);
    console.log('Channel content seeding complete.');
  } catch (error) {
    console.error('Failed to seed Discord content:', error);
    process.exit(1);
  }
})();
