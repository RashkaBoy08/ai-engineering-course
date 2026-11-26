import assert from "node:assert/strict";
import test from "node:test";
import { initializeDatabase } from "../src/database.js";
import { jokeTool, movieTool, queryDatabase } from "../src/tools.js";

function fakeDatabase({ movies = [], jokes = [] } = {}) {
  const recorded = { filters: [], updates: [] };
  const jokeRecords = new Map(jokes.map((joke) => [joke.id, structuredClone(joke)]));
  const movieRecords = new Map(movies.map((movie) => [movie.id, structuredClone(movie)]));

  const movieCollection = {
    find(filter, options) {
      recorded.filters.push({ collection: "movies", filter, options });
      let cursorRows = [...movieRecords.values()].filter((movie) => {
        for (const [key, condition] of Object.entries(filter)) {
          if (condition instanceof RegExp && !condition.test(String(movie[key] ?? ""))) return false;
          if (condition && typeof condition === "object" && !(condition instanceof RegExp)) {
            if (condition.$gt !== undefined && movie[key] <= condition.$gt) return false;
            if (condition.$gte !== undefined && movie[key] < condition.$gte) return false;
            if (condition.$lt !== undefined && movie[key] >= condition.$lt) return false;
            if (condition.$lte !== undefined && movie[key] > condition.$lte) return false;
          } else if (typeof condition === "string" && movie[key] !== condition) return false;
        }
        return true;
      });
      const cursor = {
        sort() { return cursor; },
        skip(count) { cursorRows = cursorRows.slice(count); return cursor; },
        limit(count) { cursorRows = cursorRows.slice(0, count); return cursor; },
        async toArray() { return cursorRows.map((row) => ({ ...row })); },
      };
      return cursor;
    },
    async countDocuments(filter) {
      return [...movieRecords.values()].filter((movie) =>
        Object.entries(filter).every(([key, condition]) => {
          if (condition instanceof RegExp) return condition.test(String(movie[key] ?? ""));
          if (condition && typeof condition === "object") {
            return (condition.$gt === undefined || movie[key] > condition.$gt) &&
              (condition.$gte === undefined || movie[key] >= condition.$gte) &&
              (condition.$lt === undefined || movie[key] < condition.$lt) &&
              (condition.$lte === undefined || movie[key] <= condition.$lte);
          }
          return movie[key] === condition;
        }),
      ).length;
    },
    aggregate() {
      return { async toArray() { return [{ genre: "Sci-Fi", movie_count: 2 }]; } };
    },
    async updateOne(filter, update, options = {}) {
      recorded.updates.push({ collection: "movies", filter, update, options });
      const current = movieRecords.get(filter.id);
      if (current) Object.assign(current, update.$set);
      else if (update.$set) movieRecords.set(filter.id, { ...update.$set });
      return { matchedCount: current ? 1 : 0 };
    },
    async findOne(filter) {
      return movieRecords.get(filter.id) ?? null;
    },
  };

  const jokeCollection = {
    find(filter) {
      let rows = [...jokeRecords.values()];
      if (filter.category) rows = rows.filter((joke) => joke.category === filter.category);
      if (filter.$text?.$search) {
        const terms = filter.$text.$search.toLowerCase().split(/\s+/);
        rows = rows.filter((joke) => terms.every((term) => joke.text.toLowerCase().includes(term)));
      }
      const cursor = {
        sort() { return cursor; },
        limit(count) { rows = rows.slice(0, count); return cursor; },
        async toArray() { return rows.map((row) => ({ ...row })); },
      };
      return cursor;
    },
    async updateOne(filter, update, options = {}) {
      recorded.updates.push({ collection: "jokes", filter, update, options });
      let joke = jokeRecords.get(filter.id);
      if (!joke && options.upsert) {
        joke = structuredClone(update.$setOnInsert ?? {});
        jokeRecords.set(filter.id, joke);
      } else if (!joke) {
        return { matchedCount: 0 };
      }
      for (const [path, amount] of Object.entries(update.$inc ?? {})) {
        const [parent, key] = path.split(".");
        joke[parent][key] += amount;
      }
      return { matchedCount: 1 };
    },
    async findOne(filter) {
      const joke = jokeRecords.get(filter.id);
      return joke ? { ...joke } : null;
    },
  };

  return {
    recorded,
    collection(name) {
      if (name === "movies") return movieCollection;
      if (name === "jokes") return jokeCollection;
      throw new Error(`Unexpected collection: ${name}`);
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("database setup creates validated collections and performance indexes", async () => {
  const createdCollections = [];
  const createdIndexes = [];
  const database = {
    listCollections() {
      return { async toArray() { return []; } };
    },
    async createCollection(name, options) {
      createdCollections.push({ name, options });
    },
    collection(name) {
      return {
        async createIndex(specification, options) {
          createdIndexes.push({ name, specification, options });
        },
      };
    },
  };

  await initializeDatabase(database);

  assert.deepEqual(createdCollections.map(({ name }) => name), [
    "movies",
    "users",
    "reviews",
    "jokes",
    "conversations",
    "preferences",
    "tool_usage",
  ]);
  assert.ok(createdCollections.find(({ name }) => name === "movies").options.validator.$jsonSchema);
  assert.ok(createdCollections.find(({ name }) => name === "reviews").options.validator.$jsonSchema);
  assert.ok(createdIndexes.some(({ name, specification }) =>
    name === "movies" && specification.genre === 1 && specification.year === -1));
  assert.ok(createdIndexes.some(({ name, specification }) =>
    name === "reviews" && specification.movie_id === 1));
  assert.ok(createdIndexes.some(({ name, specification }) =>
    name === "jokes" && specification.text === "text"));
});

test("database query returns structured, paginated, allowlisted movie results", async () => {
  const database = fakeDatabase({
    movies: [
      { id: "m1", title: "Arrival", genre: "Sci-Fi", rating: 7.9, year: 2016 },
      { id: "m2", title: "The Matrix", genre: "Sci-Fi", rating: 8.7, year: 1999 },
    ],
  });

  const result = await queryDatabase(database, {
    entity: "movies",
    genre: "sci-fi",
    min_rating: 8.5,
    page: 1,
    limit: 1,
  });

  assert.equal(result.kind, "table");
  assert.equal(result.entity, "movies");
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].title, "The Matrix");
  assert.ok(database.recorded.filters[0].filter.genre instanceof RegExp);
  assert.equal(database.recorded.filters[0].filter.rating.$gte, 8.5);
  assert.equal(database.recorded.filters[0].options.projection._id, 0);
});

test("database query validates filters and restricts genre counts to movies", async () => {
  const database = fakeDatabase();

  await assert.rejects(
    queryDatabase(database, { entity: "users", min_age: 40, max_age: 20 }),
    /Minimum age cannot exceed maximum age/,
  );
  await assert.rejects(
    queryDatabase(database, { entity: "reviews", action: "count_by_genre" }),
    /available for movies/,
  );
  await assert.rejects(
    queryDatabase(database, { entity: "movies", limit: 100 }),
    /between 1 and 20/,
  );
  await assert.rejects(
    queryDatabase(database, { entity: "users", age_above: 25.5 }),
    /whole number/,
  );

  const result = await queryDatabase(database, { entity: "movies", action: "count_by_genre" });
  assert.equal(result.rows[0].movie_count, 2);
});

test("database query uses strict greater-than for natural-language thresholds", async () => {
  let filter;
  const collection = {
    find(value) {
      filter = value;
      const cursor = {
        sort() { return cursor; },
        skip() { return cursor; },
        limit() { return cursor; },
        async toArray() { return []; },
      };
      return cursor;
    },
    async countDocuments() { return 0; },
  };
  await queryDatabase({ collection: () => collection }, {
    entity: "users",
    age_above: 25,
  });
  assert.equal(filter.age.$gt, 25);
});

test("OMDb exact lookup caches full movie details and requests a title and year", async () => {
  const database = fakeDatabase();
  const calls = [];
  const result = await movieTool(database, { title: "The Matrix", year: 1999 }, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      calls.push(new URL(url));
      return jsonResponse({
        Response: "True",
        Title: "The Matrix",
        Year: "1999",
        Genre: "Action, Sci-Fi",
        imdbRating: "8.7",
        Director: "The Wachowskis",
        Plot: "A hacker discovers reality is a simulation.",
        Poster: "https://example.test/matrix.jpg",
        Runtime: "136 min",
        Actors: "Keanu Reeves, Carrie-Anne Moss",
        Ratings: [{ Source: "Internet Movie Database", Value: "8.7/10" }],
        imdbID: "tt0133093",
      });
    },
  });

  assert.equal(calls[0].searchParams.get("t"), "The Matrix");
  assert.equal(calls[0].searchParams.get("y"), "1999");
  assert.equal(result.movies[0].runtime, "136 min");
  assert.deepEqual(result.movies[0].cast, ["Keanu Reeves", "Carrie-Anne Moss"]);
  assert.equal(database.recorded.updates[0].filter.id, "imdb-tt0133093");
  assert.equal(database.recorded.updates[0].options.upsert, true);
});

test("OMDb falls back to partial title search when an exact title is not found", async () => {
  const database = fakeDatabase();
  const calls = [];
  const result = await movieTool(database, { title: "Matrix" }, {
    apiKey: "test-key",
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      calls.push(parsed.searchParams.get("t") ? "title" : parsed.searchParams.get("s") ? "search" : "details");
      if (parsed.searchParams.has("t")) return jsonResponse({ Response: "False", Error: "Movie not found!" });
      if (parsed.searchParams.has("s")) {
        return jsonResponse({ Response: "True", Search: [{ imdbID: "tt0133093" }] });
      }
      return jsonResponse({
        Response: "True",
        Title: "The Matrix",
        Year: "1999",
        Genre: "Action, Sci-Fi",
        imdbRating: "8.7",
        imdbID: "tt0133093",
      });
    },
  });

  assert.deepEqual(calls, ["title", "search", "details"]);
  assert.equal(result.movies[0].title, "The Matrix");
  assert.match(result.message, /partial title matches/);
});

test("movie recommendations match a genre within OMDb's comma-separated genres", async () => {
  const database = fakeDatabase({
    movies: [{ id: "m1", title: "The Matrix", genre: "Action, Sci-Fi", year: 1999, rating: 8.7 }],
  });
  const result = await movieTool(database, {
    action: "recommend",
    genre: "sci-fi",
    from_year: 1990,
    to_year: 2010,
  });

  assert.equal(result.movies.length, 1);
  assert.match(database.recorded.filters[0].filter.genre.source, /sci-fi/i);
});

test("jokes tool requests JSON, caches the joke, and supports voting", async () => {
  const database = fakeDatabase();
  let acceptHeader;
  const joke = await jokeTool(database, {}, {
    retryDelayMs: 0,
    fetchImpl: async (_url, options) => {
      acceptHeader = options.headers.Accept;
      return jsonResponse({ id: "abc123", joke: "A test dad joke." });
    },
  });

  assert.equal(acceptHeader, "application/json");
  assert.equal(joke.jokes[0].text, "A test dad joke.");
  assert.equal(database.recorded.updates[0].options.upsert, true);

  const rated = await jokeTool(database, {
    action: "rate",
    id: "icanhaz-abc123",
    vote: "up",
  });
  assert.equal(rated.jokes[0].votes.up, 1);
});

test("jokes tool retries API failures and falls back to a stored dad joke", async () => {
  const database = fakeDatabase({
    jokes: [{
      id: "saved-1",
      text: "Why did the test pass? It had good assertions.",
      category: "dad",
      source: "sample data",
      votes: { up: 0, down: 0 },
      createdAt: new Date(),
    }],
  });
  let attempts = 0;
  const result = await jokeTool(database, {}, {
    attempts: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return jsonResponse({ error: "temporary" }, 503);
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.jokes[0].id, "saved-1");
  assert.match(result.message, /showing a saved joke/);
});

test("joke search filters by category and keyword; invalid votes are rejected", async () => {
  const database = fakeDatabase({
    jokes: [{
      id: "code-1",
      text: "Why do programmers love coffee? It helps them Java.",
      category: "programming",
      source: "sample data",
      votes: { up: 0, down: 0 },
      createdAt: new Date(),
    }],
  });
  const result = await jokeTool(database, {
    action: "search",
    category: "programming",
    keyword: "coffee",
  });

  assert.equal(result.jokes.length, 1);
  assert.equal(result.jokes[0].id, "code-1");
  await assert.rejects(
    jokeTool(database, { action: "rate", id: "code-1", vote: "sideways" }),
    /Vote must be up or down/,
  );
});
