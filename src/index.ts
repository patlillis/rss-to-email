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
  title: string;
  link: string;
  feedTitle: string;
  pubDate: Date;
};

type Env = {
  RSS_TO_EMAIL: KVNamespace;
  EMAIL_ADDRESS: string;
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
};

const STORAGE_KEY = 'last_check_data';

export default {
  // Handle HTTP requests
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Simple status endpoint
    if (url.pathname === '/status') {
      return new Response('RSS checker is running', { status: 200 });
    }

    // Manual trigger endpoint (protected by a simple query param for demo purposes)
    // In production, you should use proper authentication
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

  // Handle scheduled events
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
  let lastCheckData: LastCheckData;
  try {
    const storedData = await env.RSS_TO_EMAIL.get(STORAGE_KEY, { type: 'json' });
    lastCheckData = lastCheckDataSchema.parse(storedData);
  }
  catch (err) {
    console.error("Error loading lastCheckData", err);
    throw err;
  }

  const now = new Date();
  const newEntries: BlogEntry[] = [];
  const parser = new Parser();
  for (const feedUrl of feedUrls) {
    try {
      console.log(`Checking feed: ${feedUrl}`);

      const fetchFeedResult = await fetch(feedUrl);
      const feedContents = await fetchFeedResult.text();
      const feed = await parser.parseString(feedContents);

      // Check for new entries since last check
      for (const item of feed.items) {
        const entryId = item.guid ?? item.link ?? item.title;
        if (!entryId) {
          continue;
        }

        const pubDate = item.pubDate == null ? now : new Date(item.pubDate);
        // If this is a new entry we haven't seen before and it was published after our last check
        if (!lastCheckData.seenEntryIds.includes(entryId) && pubDate > new Date(lastCheckData.lastCheckEpochMillis)) {
          newEntries.push({
            title: item.title ?? '(Untitled)',
            link: item.link ?? '#',
            pubDate,
            feedTitle: feed.title ?? '(Unknown)'
          });

          // Mark this entry as seen
          lastCheckData.seenEntryIds.push(entryId);
        }
      }
    }
    catch (err) {
      console.error(`Error checking feed ${feedUrl}`, err);
      throw err;
    }
  }

  // Update the last check time
  lastCheckData.lastCheckEpochMillis = now.getDate();

  // If we found new entries, send an email
  if (newEntries.length > 0) {
    console.log(`Found ${newEntries.length} new entries to send`)
    await sendEmail(env, newEntries);
  } else {
    console.log('No new blog entries found');
  }

  // Save the updated check data
  try {
    await env.RSS_TO_EMAIL.put(STORAGE_KEY, JSON.stringify(lastCheckData));
  }
  catch (err) {
    console.error("Error saving lastCheckData", err);
    throw err;
  }
}

// Helper function to format dates in a readable format
function formatDate(date: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  };
  return date.toLocaleDateString('en-US', options);
}

async function sendEmail(env: Env, entries: BlogEntry[]): Promise<void> {
  try {
    // Format the email content
    let emailBody = `<h1>New Blog Posts</h1>
<p>Found ${entries.length} new blog post${entries.length > 1 ? 's' : ''}:</p>
<ul>`;

    // Sort entries by publication date (newest first)
    const sortedEntries = [...entries].sort((a, b) =>
      b.pubDate.getTime() - a.pubDate.getTime()
    );

    for (const entry of sortedEntries) {
      emailBody += `
  <li>
    <strong>${entry.feedTitle}</strong>: 
    <a href="${entry.link}">${entry.title}</a> 
    <span style="color: #666; font-size: 0.9em;">(${formatDate(entry.pubDate)})</span>
  </li>`;
    }

    emailBody += `
</ul>
<p>Enjoy your reading!</p>`;

    // Create SES client
    const sesClient = new SESClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      },
    });

    // Create the email parameters
    const params: SendEmailCommandInput = {
      Source: env.EMAIL_ADDRESS,
      Destination: {
        ToAddresses: [env.EMAIL_ADDRESS],
      },
      Message: {
        Subject: {
          Data: 'Daily Blog Updates',
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
    const response = await sesClient.send(command);
    console.log('Email sent successfully:', response.MessageId);
  }
  catch (err) {
    console.error("Error sending email", err);
    throw err;
  }
}
