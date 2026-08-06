# Discord bug-report bot

The site sends bug reports through the server-side `/api/discord-bug` route. The bot token is never exposed to the browser or committed to Git.

## Discord setup

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Open **Bot**, create the bot, and copy its token.
3. In **OAuth2 > URL Generator**, select the `bot` scope.
4. Grant **View Channels**, **Send Messages**, and **Embed Links**, then use the generated URL to add the bot to the server.
5. Enable Discord Developer Mode, right-click the bug channel, and copy its channel ID.

## Vercel setup

Add these environment variables to Production and Preview:

```text
DISCORD_BOT_TOKEN=your_bot_token
DISCORD_BUG_CHANNEL_ID=1533262608134705292
```

Redeploy the project after saving the variables. Reports are limited to five submissions per IP every ten minutes. If Upstash Redis is configured, that limit is shared across all Vercel instances.

Never place `DISCORD_BOT_TOKEN` in the HTML, a client-side JavaScript file, or GitHub.
https://discord.com/oauth2/authorize?client_id=839211344410312764&permissions=52224&integration_type=0&scope=bot