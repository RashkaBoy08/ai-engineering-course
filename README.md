# Smart Content Assistant

A Node.js command-line app that:

- accepts a blog topic;
- streams a generated blog outline;
- produces a two-sentence summary;
- supports follow-up questions; and
- offers creative or factual temperature settings.

## Run

1. Install Node.js 18 or newer.
2. Install dependencies:

   ```powershell
   npm install
   ```

3. Set your API key:

   ```powershell
   $env:OPENAI_API_KEY="your_api_key_here"
   ```

   Alternatively, copy `.env.example` to `.env` and enter your key there.

4. Start the app:

   ```powershell
   npm start
   ```
