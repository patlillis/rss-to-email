export default {
  // Handle HTTP requests
  async fetch(request, env, ctx) {
    return new Response('Hello from Cloudflare Worker!');
  },

  // Handle scheduled events
  async scheduled(event, env, ctx) {
    // This runs on the schedule defined in wrangler.toml
    console.log('Cron trigger executed at:', event.scheduledTime);
    
    // Add your scheduled task logic here
    // For example, fetch data from an API, process data, etc.
    
    // You can use environment variables from wrangler.toml
    console.log('Environment:', env.ENVIRONMENT);
  }
};
