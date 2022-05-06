import { App, PlainTextOption, View, Block, KnownBlock } from '@slack/bolt';
import { FastlyClient, Service } from './fastly';

export const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  customRoutes: [
    {
      path: '/health-check',
      method: ['GET'],
      handler: (_req, res) => {
        res.writeHead(200);
        res.end('OK');
      },
    },
  ],
});

const notifyChannelId = process.env.NOTIFY_CHANNEL_ID;
if (notifyChannelId === undefined) {
  console.error('NOTIFY_CHANNEL_ID is required');
  process.exit(1);
}

const fastlyApiToken = process.env.FASTLY_API_TOKEN;
if (fastlyApiToken === undefined) {
  console.error('FASTLY_API_TOKEN is required');
  process.exit(1);
}
const fastlyClient = new FastlyClient(fastlyApiToken);

(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`Listening :${port}`);
})();

const PURGE_METHODS = {
  ByService: "BY_SERVICE",
  ByUrl: "BY_URL",
} as const;
type PurgeMethod = typeof PURGE_METHODS[keyof typeof PURGE_METHODS];

const BLOCK_IDS = {
  selectPurgeMethod: "block-select-purge-method",
  selectService: "block-select-service",
  selectSoftPurge: "block-select-soft-purge",
  selectSurrogateKeys: "block-select-surrogate-keys",
  selectUrl: "block-select-url",
} as const;

const ACTION_IDS = {
  selectPurgeMethod: "action-select-purge-method",
  selectService: "action-select-service-block",
  selectSoftPurge: "action-select-soft-purge",
  selectSurrogateKeys: "action-select-surrogate-keys",
  selectUrl: "action-select-url",
} as const;

const VIEW_IDS = {
  selectPurgeMethod: "view-select-purge-method",
  selectService: "view-select-service",
  selectUrl: "view-select-url",
} as const;

const ViewTitle = "Purge Fastly cache"

// 1. Receive a slash command
app.command('/fastly-purge', async ({ ack, body, client, logger }) => {
  logger.info(`${body.user_id} triggered the action`);

  await ack();
  try {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: buildSelectPurgeMethodView(),
    });
  } catch (error) {
    logger.error(error);
  }
});

// 2. Select the purge method
app.action({ type: 'block_actions', action_id: ACTION_IDS.selectPurgeMethod }, async ({ ack, body, client, logger }) => {
  await ack();

  if (body.view === undefined) {
    throw Error('body.view is undefined!');
  }

  const purgeMethod = body.view.state.values[BLOCK_IDS.selectPurgeMethod][ACTION_IDS.selectPurgeMethod].selected_option!.value as PurgeMethod;
  logger.info(`${body.user.id} selected purge method ==> ${purgeMethod}`);

  try {
    switch(purgeMethod) {
      case PURGE_METHODS.ByService:
        const services = await fastlyClient.ListServices();
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildPurgeByServiceView(services),
        });
        break;
      case PURGE_METHODS.ByUrl:
        await client.views.push({
          trigger_id: body.trigger_id,
          view: buildPurgeByUrlView(),
        });
        break;
    }
  } catch (error) {
    logger.error(error);
  }
});

// 3-a. Purge by service and finish the view
app.view(VIEW_IDS.selectService, async ({ ack, body, view, client, logger }) => {
  try {
    await ack({response_action: 'update', view: buildUpdatedView()});
  } catch(error) {
    logger.error(`failed to update view: ${error}`);
    return;
  }

  let purgeResult = "Succeeded!";
  const serviceId = view.state.values[BLOCK_IDS.selectService][ACTION_IDS.selectService].selected_option!.value;
  const softPurge = view.state.values[BLOCK_IDS.selectSoftPurge][ACTION_IDS.selectSoftPurge].selected_option!.value === 'true';
  const surrogateKeysStr = view.state.values[BLOCK_IDS.selectSurrogateKeys][ACTION_IDS.selectSurrogateKeys].value;
  const surrogateKeys = surrogateKeysStr ? surrogateKeysStr.split(",") : [];

  const service = await fastlyClient.getService(serviceId).catch((error: any) => { throw error; });

  try {
    if (surrogateKeys.length === 0) {
      await fastlyClient.PurgeAll(serviceId);
      logger.info(`Performed purge-all. serviceId:${serviceId} softPurge:${softPurge} surrogateKeys:${surrogateKeys} user:${body.user.id}`);
    } else {
      await fastlyClient.Purge(serviceId, surrogateKeys, softPurge)
      logger.info(`Performed purge. serviceId:${serviceId} softPurge:${softPurge} surrogateKeys:${surrogateKeys} user:${body.user.id}`);
    }
  } catch(error: any) {
    logger.error(`failed to purge fastly cache: ${error}`);
    purgeResult = error;
  }

  const fields = new Map<string, string>();
  fields.set("Method", PURGE_METHODS.ByService);
  fields.set("Service", service.name);
  fields.set("Soft purge", String(softPurge));
  fields.set("Surrogate keys", surrogateKeys.join(","));

  await client.chat.postMessage({
    channel: notifyChannelId,
    text: `<@${body.user.id}> have a new request:`,
    blocks: buildResultBlocks(fields, purgeResult),
  }).catch(e => { logger.error(e) });
});

// 3-b. Purge by URL and finish the view
app.view(VIEW_IDS.selectUrl, async ({ ack, body, view, client, logger }) => {
  try {
    await ack({response_action: 'update', view: buildUpdatedView()});
  } catch(error) {
    logger.error(`failed to update view: ${error}`);
    return;
  }

  let purgeResult = "Succeeded!";
  const purge = view.state.values[BLOCK_IDS.selectSoftPurge][ACTION_IDS.selectSoftPurge].selected_option!.value;
  const softPurge = purge === 'true';
  const url = view.state.values[BLOCK_IDS.selectUrl][ACTION_IDS.selectUrl].value!;

  try {
    await fastlyClient.PurgeUrl(url, softPurge);
    logger.info(`Performed purge-url. url:${url} softPurge:${softPurge} user:${body.user.id}`);
  } catch(error: any) {
    logger.error(`failed to purge fastly cache: ${error}`);
    purgeResult = error;
  }

  const fields = new Map<string, string>();
  fields.set("Method", PURGE_METHODS.ByUrl);
  fields.set("Soft purge", String(softPurge));

  await client.chat.postMessage({
    channel: notifyChannelId,
    text: `<@${body.user.id}> have a new request:`,
    blocks: buildResultBlocks(fields, purgeResult),
  }).catch(e => { console.error(e) });
});

const buildSelectPurgeMethodView = (): View => {
  return {
    type: 'modal',
    callback_id: VIEW_IDS.selectPurgeMethod,
    title: {
      type: 'plain_text',
      text: ViewTitle,
    },
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Step 1/3', // TODO
        },
      },
      {
        type: 'section',
        block_id: BLOCK_IDS.selectPurgeMethod,
        text: {
          type: 'mrkdwn',
          text: 'This command purges Fastly cache in two ways. Select the method first.',
        },
        accessory: {
          type: "static_select",
          action_id: ACTION_IDS.selectPurgeMethod,
          placeholder: {
            type: "plain_text",
            text: "method",
          },
          options: [
            {
              text: {
                type: "plain_text",
                text: "By Service",
              },
              value: PURGE_METHODS.ByService,
            },
            {
              text: {
                type: "plain_text",
                text: "By URL",
              },
              value: PURGE_METHODS.ByUrl,
            }
          ],
        }
      },
    ],
  };
};


const buildPurgeByServiceView = (services: Array<Service>): View => {
  const serviceOptions: Array<PlainTextOption> = services.map((service) => {
    return {
      text: {
        type: 'plain_text',
        text: service.name,
      },
      value: service.id,
    }
  });

  return {
    type: 'modal',
    callback_id: VIEW_IDS.selectService,
    title: {
      type: 'plain_text',
      text: ViewTitle,
    },
    submit: {
      type: "plain_text",
      text: "Submit",
    },
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Step 2/3', // TODO
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Selected method: *By service*. Fill in the following property.`,
        },
      },
      {
        type: 'input',
        label: {
          type: 'plain_text',
          text: 'Service'
        },
        block_id: BLOCK_IDS.selectService,
        element: {
          type: 'static_select',
          options: serviceOptions,
          action_id: ACTION_IDS.selectService,
        }
      },
      {
        type: 'input',
        label: {
          type: 'plain_text',
          text: 'Soft Purge'
        },
        block_id: BLOCK_IDS.selectSoftPurge,
        element: {
          type: 'radio_buttons',
          action_id: ACTION_IDS.selectSoftPurge,
          initial_option: {
            text: {
              type: 'plain_text',
              text: 'false',
            },
            value: 'false',
          },
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'false',
              },
              value: 'false',
            },
            {
              text: {
                type: 'plain_text',
                text: 'true',
              },
              value: 'true',
            },
          ],
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '<https://docs.fastly.com/en/guides/soft-purges|Soft purge> marks content as outdated (stale)'
          }
        ]
      },
      {
        type: 'input',
        block_id: BLOCK_IDS.selectSurrogateKeys,
        element: {
          type: 'plain_text_input',
          action_id: ACTION_IDS.selectSurrogateKeys,
          placeholder: {
            type: 'plain_text',
            text: 'foo,bar',
          },
        },
        optional: true,
        label: {
          type: 'plain_text',
          text: 'Surrogate keys (Comma-separated)'
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: 'If no surrogate keys provided, <https://developer.fastly.com/reference/api/purging/#purge-all|purge-all> will be performed',
          }
        ]
      }
    ],
  }
};

const buildPurgeByUrlView = (): View => {
  return {
    type: 'modal',
    callback_id: VIEW_IDS.selectUrl,
    title: {
      type: 'plain_text',
      text: ViewTitle,
    },
    submit: {
      type: "plain_text",
      text: "Submit",
    },
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Step 2/3', // TODO
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Selected method: *By URL*. Fill in the following property.`,
        },
      },
      {
        type: 'input',
        block_id: BLOCK_IDS.selectUrl,
        element: {
          type: 'plain_text_input',
          action_id: ACTION_IDS.selectUrl,
          placeholder: {
            type: 'plain_text',
            text: 'https://',
          },
        },
        label: {
          type: 'plain_text',
          text: 'URL'
        }
      },
      {
        type: 'input',
        block_id: BLOCK_IDS.selectSoftPurge,
        label: {
          type: 'plain_text',
          text: 'Soft purge'
        },
        element: {
          type: 'radio_buttons',
          action_id: ACTION_IDS.selectSoftPurge,
          options: [
            {
              text: {
                type: 'plain_text',
                text: 'false',
              },
              value: 'false',
            },
            {
              text: {
                type: 'plain_text',
                text: 'true',
              },
              value: 'true',
            },
          ]
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: '<https://docs.fastly.com/en/guides/soft-purges|Soft purge> marks content as outdated (stale) '
          }
        ]
      }
    ],
  }
};

const buildResultBlocks = (fields: Map<string, string>, result: string): Array<Block | KnownBlock> => {
  return [
    {
      type: 'section',
      fields: [...fields.entries()].map((v) => {
        return {
          type: 'mrkdwn',
          text: `*${v[0]}:*\n${v[1]}`,
        }
      }),
    },
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'Result',
      }
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: result,
      }
    },
  ];
}

const buildUpdatedView = (): View => {
  return {
    type: 'modal',
    callback_id: 'TODO',
    title: {
      type: 'plain_text',
      text: ViewTitle,
    },
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: 'Step 3/3', // TODO
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Request done!*',
        },
      },
    ],
  }
};
