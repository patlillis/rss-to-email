import Parser from 'rss-parser';
import { KVNamespace, ScheduledEvent } from '@cloudflare/workers-types';
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput
} from '@aws-sdk/client-ses';
import { z } from 'zod';

import { feedUrls } from './feedUrls';

const lastCheckDataSchema = z.object({
  lastCheckEpochMillis: z.number(),
  seenEntryIds: z.array(z.string()),
});

type LastCheckData = z.infer<typeof lastCheckDataSchema>;

type BlogEntry = {
  pubDate: Date;
  feedTitle?: string;
  title?: string;
  link?: string;
  summary?: string;
  author?: string;
};

type Env = {
  RSS_TO_EMAIL: KVNamespace;
  FROM_EMAIL_ADDRESS: string;
  TO_EMAIL_ADDRESS: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
};

const STORAGE_KEY = 'last_check_data';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/status') {
      return new Response('RSS checker is running', { status: 200 });
    }

    if (url.pathname === '/check' && url.searchParams.get('key') === 'manual-trigger-key') {
      try {
        await checkRSSFeeds(env);
        return new Response('RSS check completed successfully', { status: 200 });
      } catch (error) {
        console.error('Error during RSS check:', error);
        return new Response('Error during RSS check', { status: 500 });
      }
    }

    return new Response('Hello from RSS Checker Worker!', { status: 200 });
  },

  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    console.log('Daily RSS check triggered at:', new Date(event.scheduledTime).toISOString());
    try {
      await checkRSSFeeds(env);
      console.log('RSS check completed successfully');
    } catch (error) {
      console.error('Error during scheduled RSS check:', error);
    }
  }
};

async function checkRSSFeeds(env: Env): Promise<void> {
  console.log("Checking RSS feeds");

  let lastCheckData: LastCheckData;
  try {
    const storedData = await env.RSS_TO_EMAIL.get(STORAGE_KEY, { type: 'json' });
    lastCheckData = lastCheckDataSchema.parse(storedData);
  }
  catch (err) {
    console.error("Error loading lastCheckData", err);
    throw err;
  }

  console.log("Loaded lastCheckData", { lastCheckData });

  const lastCheckDate = new Date(lastCheckData.lastCheckEpochMillis);
  const now = new Date();
  const newEntries: BlogEntry[] = [];
  type CustomFeed = {
    author?: {
      name?: string;
    }
  };
  type CustomItem = {
    summary?: string;
  }
  const parser = new Parser<CustomFeed, CustomItem>({
    customFields: {
      feed: ['author'],
      item: ['summary']
    }
  });

  for (const feedUrl of feedUrls) {
    console.group(feedUrl)
    console.log(`Checking feed: ${feedUrl}`);

    try {
      const fetchFeedResult = await fetch(feedUrl);
      const feedContents = await fetchFeedResult.text();
      const feed = await parser.parseString(feedContents);

      for (const item of feed.items) {
        const entryId = item.guid ?? item.link ?? item.title;
        if (!entryId) {
          continue;
        }

        const pubDate = item.pubDate == null ? now : new Date(item.pubDate);
        const alreadySeen = lastCheckData.seenEntryIds.includes(entryId);
        const isNew = pubDate > lastCheckDate;
        console.log(`Found entry ${entryId}`, { pubDate, alreadySeen, isNew });

        if (!alreadySeen && isNew) {
          const newEntry: BlogEntry = {
            title: item.title,
            link: item.link,
            pubDate,
            summary: item.summary,
            feedTitle: feed.title ?? feedUrl,
            author: item.creator ?? feed.author?.name
          };

          newEntries.push(newEntry);
          lastCheckData.seenEntryIds.push(entryId);
        }
      }
    }
    catch (err) {
      console.error(`Error checking feed ${feedUrl}`, err);
      throw err;
    }
    finally {
      console.groupEnd()
    }
  }

  if (newEntries.length > 0) {
    const ses = new SESClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });
    await Promise.all(newEntries.map(entry => sendEmail(env, entry, ses)));
  } else {
    console.log('No new blog entries found');
  }

  try {
    lastCheckData.lastCheckEpochMillis = now.valueOf();
    console.log("Updating lastCheckData", { lastCheckData });
    await env.RSS_TO_EMAIL.put(STORAGE_KEY, JSON.stringify(lastCheckData));
  }
  catch (err) {
    console.error("Error saving lastCheckData", err);
    throw err;
  }
}

async function sendEmail(env: Env, entry: BlogEntry, ses: SESClient): Promise<void> {
  try {
    const feedTitle = entry.feedTitle ?? "(Unknown)";
    const link = entry.link ?? "#";
    const title = entry.title ?? "(Untitled)";

    const emailBody = `<h1>New Post from "${feedTitle}"</h1>
<div style="margin: 20px 0; padding: 15px; border: 1px solid #ddd; border-radius: 5px;">
  <h2><a href="${link}">${title}</a></h2>
  ${entry.author ? `<p>By: ${entry.author}</p>` : ''}
  ${entry.summary ?? ''}
  <p style="color: #666;">Published on: ${formatDate(entry.pubDate)}</p>
</div>`;

    // Create the email parameters
    const params: SendEmailCommandInput = {
      Source: `${entry.author} <${env.FROM_EMAIL_ADDRESS}>`,
      Destination: {
        ToAddresses: [`Pat Slick <${env.TO_EMAIL_ADDRESS}>`],
      },
      Message: {
        Subject: {
          Data: entry.title,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: emailBody,
            Charset: 'UTF-8',
          },
        },
      },
    };

    // Send the email
    const command = new SendEmailCommand(params);
    const response = await ses.send(command);
    console.log(`Email sent for "${entry.title}"`, { messageId: response.MessageId });
  }
  catch (err) {
    console.error(`Error sending email for "${entry.title}"`, err);
    throw err;
  }
}

function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };
  return date.toLocaleDateString('en-US', options);
}