# Movie Chatbot

A Node.js chatbot with three tools: MongoDB questions, OMDb movie lookup, and dad jokes. The browser UI renders database results as tables, movies as poster cards, and jokes with voting controls.

## Requirements

- Node.js 18 or newer
- MongoDB Community Server running locally, or a MongoDB connection string
- OpenAI API key for natural-language tool selection
- OMDb API key for live movie lookup (the database and jokes tools can still be used without it)

## Setup

From this folder:

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set `OPENAI_API_KEY`. Set `OMDB_API_KEY` to enable live OMDb lookups. The MongoDB defaults work with a local MongoDB server.

Create collections, validation rules, indexes, and sample movies, users, reviews, and jokes:

```powershell
npm run seed
```

Start the app:

```powershell
npm start
```

Open [http://localhost:3000](http://localhost:3000). Ask natural-language questions such as:

- “Show me all sci-fi movies”
- “Find users over 25”
- “Get movies with a rating above 8.5”
- “Count total movies by genre”
- “Look up The Matrix from 1999”
- “Recommend comedy movies from 1990 to 2010”
- “Tell me a programming joke” or “Search jokes for keyboard”

Conversation history, API caches, preferences, and tool usage are stored in MongoDB. The app creates its collections and indexes when it starts; seed data is added by `npm run seed`.

## Tools and data

- **Database tool:** Read-only, allowlisted movie/user/review searches and genre counts, with pagination and structured table results.
- **Movie tool:** Searches OMDb by title/year, uses partial-title search as a fallback, caches details, and recommends matching cached movies.
- **Jokes tool:** Fetches random jokes from icanhazdadjoke.com, caches them, searches and votes on stored jokes, and uses seeded/stored jokes when the API is unavailable.
- **MongoDB collections:** `movies`, `users`, `reviews`, `jokes`, `conversations`, `preferences`, and `tool_usage`.

## Tests

```powershell
npm test
```

Tests use mocked API responses and in-memory collection doubles; they do not require API keys or a running MongoDB server.

## Troubleshooting

- **MongoDB connection refused:** Start MongoDB, check `MONGODB_URI`, then run `npm run seed` again.
- **OpenAI key missing/invalid:** Set `OPENAI_API_KEY` in `.env`; the chatbot needs it to interpret natural-language requests.
- **OMDb lookup unavailable:** Set a valid `OMDB_API_KEY`. MongoDB recommendations use cached and sample data and do not require OMDb.
- **No results:** Seed the database and try a broader title, genre, or year range.
- **Port already in use:** Change `PORT` in `.env`.
