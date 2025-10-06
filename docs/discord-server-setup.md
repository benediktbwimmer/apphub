# Discord Server Setup for Osiris AppHub

The repository ships with `scripts/setup-discord-server.js`, which bootstraps roles, categories, and channels for the Osiris AppHub community server. Use it anytime you need to recreate the structure or bring a fresh server in line with the OSS collaboration defaults.

## Prerequisites

- A Discord bot in your account (private is recommended) that has been invited to the target server.
- The bot token, stored securely. Never commit it to source control.
- Optional: set `DISCORD_GUILD_NAME` if the server is not named `Osiris AppHub`.

## Running the script

```bash
DISCORD_BOT_TOKEN="<your-bot-token>" \
DISCORD_GUILD_NAME="Osiris AppHub" \
node scripts/setup-discord-server.js
```

The script is idempotent. It creates or updates the following:

- **Roles**: Maintainer (admin), Core Team, Contributor, Community, Bots.
- **Categories**: Info, Development, Community, Voice.
- **Info Channels**: `#welcome`, `#announcements`, `#changelog`, `#release-notes` (read-only for everyone except Maintainer/Core Team).
- **Development Channels**: `#general-dev`, `#frontend`, `#services`, `#infra`, `#testing`.
- **Community Channels**: `#introductions`, `#support`, `#showcase`.
- **Voice Channels**: `Standups`, `Pairing`.

If a channel already exists, the script re-homes it under the expected category and refreshes the read-only permissions for announcement channels.

## Operational Notes

- Keep the bot token in a secrets manager or `.env` file ignored by git.
- Rerun the script after manual structural changes to bring the server back to the canonical layout.
- Extend the role/channel definitions inside the script when the collaboration model evolves; rerun to apply.
- For public community features (Rules, Membership Screening), enable them manually inside Discord once the base structure is in place.
