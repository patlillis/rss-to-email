import Parser from 'rss-parser';
import { ExecutionContext, KVNamespace, ScheduledEvent } from '@cloudflare/workers-types';
import dayjs from 'dayjs';

import { feeds } from './feeds';

// Define types for our data structures
type LastCheckData = {
  lastCheck: number;
  seenEntries: Record<string, number>;
};

type BlogEntry = {
  title: string;
  link: string;
  feedTitle: string;
  date: string;
  pubDate: Date;
};

type Env = {
  BLOG_KV: KVNamespace;
  EMAIL_TO: string;
  EMAIL_FROM: string;
  EMAIL_SUBJECT: string;
};

const STORAGE_KEY = 'last_check_data';

export default {
  // Handle HTTP requests
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
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
  const parser = new Parser();

  // Use the hardcoded feed URLs from feeds.ts
  const feedUrls = feeds;

  // Get the last check data from KV or create default
  let lastCheckData: LastCheckData;
  try {
    const storedData = await env.BLOG_KV.get(STORAGE_KEY, { type: 'json' });
    lastCheckData = storedData as LastCheckData || { lastCheck: 0, seenEntries: {} };
  } catch (error) {
    console.error('Error retrieving last check data:', error);
    lastCheckData = { lastCheck: 0, seenEntries: {} };
  }

  const now = Date.now();
  const newEntries: BlogEntry[] = [];

  // Process each feed
  for (const feedUrl of feedUrls) {
    try {
      console.log(`Checking feed: ${feedUrl}`);
      const feed = await parser.parseURL(feedUrl);

      // Check for new entries since last check
      for (const item of feed.items) {
        const entryId = item.guid ?? item.link ?? item.title ?? '';
        const pubDate = item.pubDate ? new Date(item.pubDate).getTime() : now;

        // If this is a new entry we haven't seen before and it was published after our last check
        if (!lastCheckData.seenEntries[entryId] && pubDate > lastCheckData.lastCheck) {
          const pubDateObj = item.pubDate ? new Date(item.pubDate) : new Date();
          const dayjsDate = dayjs(pubDateObj);
          
          newEntries.push({
            title: item.title ?? 'Untitled',
            link: item.link ?? '#',
            date: dayjsDate.format('MMM D, YYYY'),  // Format as "Apr 10, 2025"
            pubDate: pubDateObj,
            feedTitle: feed.title || 'Unknown Blog'
          });

          // Mark this entry as seen
          lastCheckData.seenEntries[entryId] = now;
        }
      }
    } catch (error) {
      console.error(`Error processing feed ${feedUrl}:`, error);
    }
  }

  // Update the last check time
  lastCheckData.lastCheck = now;

  // Save the updated check data
  try {
    await env.BLOG_KV.put(STORAGE_KEY, JSON.stringify(lastCheckData));
  } catch (error) {
    console.error('Error saving check data:', error);
  }

  // If we found new entries, send an email
  if (newEntries.length > 0) {
    await sendEmail(env, newEntries);
  } else {
    console.log('No new blog entries found');
  }
}

async function sendEmail(env: Env, entries: BlogEntry[]): Promise<void> {
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
    <span style="color: #666; font-size: 0.9em;">(${entry.date})</span>
  </li>`;
  }

  emailBody += `
</ul>
<p>Enjoy your reading!</p>`;

  // Use Cloudflare Email Workers to send the email
  try {
    const emailTo = env.EMAIL_TO;
    const emailFrom = env.EMAIL_FROM;
    const emailSubject = env.EMAIL_SUBJECT;

    // Send email using Cloudflare Email Workers
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: emailTo }],
          },
        ],
        from: {
          email: emailFrom,
        },
        subject: emailSubject,
        content: [
          {
            type: 'text/html',
            value: emailBody,
          },
        ],
      }),
    });

    if (response.status === 202) {
      console.log('Email sent successfully');
    } else {
      console.error('Failed to send email:', await response.text());
    }
  } catch (error) {
    console.error('Error sending email:', error);
  }
}
