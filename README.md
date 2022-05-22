# fastly-purge-bot

A slackbot to purge Fastly cache.

## Configuration

| Environment variable name  | Required | Description |
|---|---|---|
| SLACK_BOT_TOKEN | Yes |  |
| SLACK_SIGNING_SECRET | Yes | |
| FASTLY_API_TOKEN | Yes | Scopes: [global:read, purge_all, purge_select] |
| NOTIFY_CHANNEL_ID | Yes | Slack channel ID used to notify result |
| PORT | No | Listen port (default :3000) |
| ACCESSIBLE_GROUP_IDS | No | Slack group IDs (Comma-separated) that can invoke command |
| ADMIN_GROUP_ID | No | Slack group ID of the admin. If specified, a request from members except the admin require the approval of the admin. ACCESSIBLE_GROUP_IDS is also required. |

## Setup

1. Deploy the docker image somewhere and expose to the Internet.
2. Create a Slack App. The example manifest is [here](https://github.com/itkq/fastly-purge-bot/blob/main/example/app_manifest.json) (Rewrite `[HOST]` with your hosting URL).
3. Invite the bot to the Slack channel (NOTIFY_CHANNEL_ID).

## Usage

Say `/fastly-purge`.

## Demo

https://user-images.githubusercontent.com/8341422/169656063-068f14bd-1577-4f24-9424-6abdde65adcc.mov
