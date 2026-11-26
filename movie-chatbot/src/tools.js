import { randomUUID } from "node:crypto";

const tableFields = {
  movies: ["id", "title", "year", "genre", "rating", "director", "description", "poster", "runtime"],
  users: ["id", "name", "email", "age", "favorite_genre"],
  reviews: ["id", "movie_id", "user_id", "rating", "comment", "date"],
};

const fieldLabels = {
  movie_id: "Movie ID",
  user_id: "User ID",
  favorite_genre: "Favorite genre",
  description: "Description",
};

function assertString(value, name, maximumLength = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new Error(`${name} must be a non-empty string of at most ${maximumLength} characters.`);
  }
  return value.trim();
}

function optionalNumber(value, name, minimum, maximum) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number from ${minimum} to ${maximum}.`);
  }
  return parsed;
}

function optionalInteger(value, name, minimum, maximum) {
  const parsed = optionalNumber(value, name, minimum, maximum);
  if (parsed !== undefined && !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a whole number.`);
  }
  return parsed;
}

function safePage(value) {
  const page = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(page) || page < 1 || page > 10000) {
    throw new Error("Page must be a positive whole number no greater than 10000.");
  }
  return page;
}

function safeLimit(value) {
  const limit = value === undefined ? 10 : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Page size must be a whole number between 1 and 20.");
  }
  return limit;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeDocument(document) {
  const { _id, ...result } = document;
  return result;
}

function titleCase(value) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function tableResult(entity, rows, page, pageSize, total) {
  return {
    kind: "table",
    entity,
    columns: tableFields[entity].map((key) => ({ key, label: fieldLabels[key] ?? titleCase(key) })),
    rows: rows.map(serializeDocument),
    page,
    pageSize,
    total,
  };
}

export async function queryDatabase(db, args = {}) {
  const entity = args.entity;
  if (!Object.hasOwn(tableFields, entity)) {
    throw new Error("Choose movies, users, or reviews for a database question.");
  }
  const action = args.action ?? "search";
  if (action !== "search" && action !== "count_by_genre") {
    throw new Error("Database action must be search or count_by_genre.");
  }
  if (action === "count_by_genre") {
    if (entity !== "movies") {
      throw new Error("Genre counts are available for movies.");
    }
    const groups = await db.collection("movies").aggregate([
      { $group: { _id: "$genre", count: { $sum: 1 } } },
      { $sort: { count: -1, _id: 1 } },
      { $project: { _id: 0, genre: "$_id", movie_count: "$count" } },
    ]).toArray();
    return {
      kind: "table",
      entity: "genre_counts",
      columns: [
        { key: "genre", label: "Genre" },
        { key: "movie_count", label: "Movie count" },
      ],
      rows: groups,
      total: groups.length,
    };
  }

  const filter = {};
  const genre = args.genre === undefined ? undefined : assertString(args.genre, "Genre", 60);
  const title = args.title === undefined ? undefined : assertString(args.title, "Title", 120);
  const minAge = optionalInteger(args.min_age, "Minimum age", 1, 120);
  const ageAbove = optionalInteger(args.age_above, "Age threshold", 1, 120);
  const maxAge = optionalInteger(args.max_age, "Maximum age", 1, 120);
  const minRating = optionalNumber(args.min_rating, "Minimum rating", 0, 10);
  const ratingAbove = optionalNumber(args.rating_above, "Rating threshold", 0, 10);
  const maxRating = optionalNumber(args.max_rating, "Maximum rating", 0, 10);
  const ratingBelow = optionalNumber(args.rating_below, "Rating threshold", 0, 10);
  const minYear = optionalInteger(args.min_year, "Minimum year", 1888, 2200);
  const maxYear = optionalInteger(args.max_year, "Maximum year", 1888, 2200);

  if (minAge !== undefined && maxAge !== undefined && minAge > maxAge) {
    throw new Error("Minimum age cannot exceed maximum age.");
  }
  if (ageAbove !== undefined && maxAge !== undefined && ageAbove >= maxAge) {
    throw new Error("Age threshold must be lower than maximum age.");
  }
  if (
    (minRating !== undefined && maxRating !== undefined && minRating > maxRating) ||
    (ratingAbove !== undefined && maxRating !== undefined && ratingAbove >= maxRating) ||
    (minRating !== undefined && ratingBelow !== undefined && minRating >= ratingBelow) ||
    (ratingAbove !== undefined && ratingBelow !== undefined && ratingAbove >= ratingBelow)
  ) {
    throw new Error("Minimum rating cannot exceed maximum rating.");
  }
  if (minYear !== undefined && maxYear !== undefined && minYear > maxYear) {
    throw new Error("Minimum year cannot exceed maximum year.");
  }

  if (entity === "movies") {
    if (genre) filter.genre = new RegExp(`^${escapeRegExp(genre)}$`, "i");
    if (title) filter.title = new RegExp(escapeRegExp(title), "i");
    const year = {};
    if (minYear !== undefined) year.$gte = minYear;
    if (maxYear !== undefined) year.$lte = maxYear;
    if (Object.keys(year).length) filter.year = year;
    const rating = {};
    if (minRating !== undefined) rating.$gte = minRating;
    if (ratingAbove !== undefined) rating.$gt = ratingAbove;
    if (maxRating !== undefined) rating.$lte = maxRating;
    if (ratingBelow !== undefined) rating.$lt = ratingBelow;
    if (Object.keys(rating).length) filter.rating = rating;
  } else if (entity === "users") {
    if (genre) filter.favorite_genre = new RegExp(`^${escapeRegExp(genre)}$`, "i");
    const age = {};
    if (minAge !== undefined) age.$gte = minAge;
    if (ageAbove !== undefined) age.$gt = ageAbove;
    if (maxAge !== undefined) age.$lte = maxAge;
    if (Object.keys(age).length) filter.age = age;
  } else {
    if (args.movie_id !== undefined) filter.movie_id = assertString(args.movie_id, "Movie ID", 100);
    if (args.user_id !== undefined) filter.user_id = assertString(args.user_id, "User ID", 100);
    if (
      minRating !== undefined ||
      ratingAbove !== undefined ||
      maxRating !== undefined ||
      ratingBelow !== undefined
    ) {
      filter.rating = {};
      if (minRating !== undefined) filter.rating.$gte = minRating;
      if (ratingAbove !== undefined) filter.rating.$gt = ratingAbove;
      if (maxRating !== undefined) filter.rating.$lte = maxRating;
      if (ratingBelow !== undefined) filter.rating.$lt = ratingBelow;
    }
  }

  const page = safePage(args.page);
  const pageSize = safeLimit(args.limit);
  const collection = db.collection(entity);
  const [rows, total] = await Promise.all([
    collection.find(filter, { projection: { _id: 0 } })
      .sort(entity === "movies" ? { rating: -1, year: -1 } : { date: -1, name: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    collection.countDocuments(filter),
  ]);
  return tableResult(entity, rows, page, pageSize, total);
}

async function fetchJsonWithRetry(url, options, {
  fetchImpl = fetch,
  attempts = 3,
  retryDelayMs = 150,
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const requestOptions = {
        ...(options ?? {}),
        signal: options?.signal ?? AbortSignal.timeout(10000),
      };
      const response = await fetchImpl(url, requestOptions);
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Temporary API error (${response.status}).`);
      }
      if (!response.ok) {
        throw new Error(`API request failed (${response.status}).`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || (error.message.startsWith("API request failed (") &&
        !error.message.includes("(429)"))) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
  throw lastError;
}

function movieFromOmdb(details) {
  const year = Number.parseInt(details.Year, 10);
  const rating = Number.parseFloat(details.imdbRating);
  const imdbId = typeof details.imdbID === "string" ? details.imdbID : undefined;
  const title = details.Title?.trim();
  if (!title || !Number.isFinite(year)) {
    throw new Error("OMDb returned movie details in an unexpected format.");
  }
  const ratingEntries = Array.isArray(details.Ratings) ? details.Ratings : [];
  return {
    id: imdbId ? `imdb-${imdbId}` : `movie-${randomUUID()}`,
    title,
    year,
    genre: details.Genre?.trim() || "Unknown",
    rating: Number.isFinite(rating) ? rating : null,
    director: details.Director && details.Director !== "N/A" ? details.Director : "Unknown",
    description: details.Plot && details.Plot !== "N/A" ? details.Plot : "No plot summary provided.",
    poster: details.Poster && details.Poster !== "N/A" ? details.Poster : null,
    runtime: details.Runtime && details.Runtime !== "N/A" ? details.Runtime : null,
    cast: details.Actors && details.Actors !== "N/A"
      ? details.Actors.split(",").map((actor) => actor.trim())
      : [],
    omdbRatings: ratingEntries,
    ...(imdbId ? { imdbId } : {}),
    cachedAt: new Date(),
  };
}

async function requestOmdb(parameters, apiKey, requestOptions) {
  const url = new URL("https://www.omdbapi.com/");
  for (const [key, value] of Object.entries({ ...parameters, apikey: apiKey })) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return fetchJsonWithRetry(url, undefined, requestOptions);
}

function assertOmdbSuccess(result) {
  if (result?.Response === "False") {
    throw new Error(result.Error || "OMDb did not find that movie.");
  }
  if (!result || typeof result !== "object") {
    throw new Error("OMDb returned an invalid response.");
  }
  return result;
}

async function cacheMovie(db, movie) {
  const { id, ...fields } = movie;
  await db.collection("movies").updateOne(
    { id },
    { $set: { ...fields, id }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  return movie;
}

function movieCard(movie) {
  return {
    id: movie.id,
    title: movie.title,
    year: movie.year,
    genre: movie.genre,
    rating: movie.rating,
    director: movie.director,
    description: movie.description,
    poster: movie.poster ?? null,
    runtime: movie.runtime ?? null,
    cast: movie.cast ?? [],
    omdbRatings: movie.omdbRatings ?? [],
  };
}

export async function movieTool(db, args = {}, {
  apiKey = process.env.OMDB_API_KEY,
  fetchImpl = fetch,
  attempts,
  retryDelayMs,
} = {}) {
  const action = args.action ?? "lookup";
  if (action === "recommend") {
    const genre = assertString(args.genre, "Genre", 60);
    const fromYear = optionalInteger(args.from_year, "Start year", 1888, 2200);
    const toYear = optionalInteger(args.to_year, "End year", 1888, 2200);
    if (fromYear !== undefined && toYear !== undefined && fromYear > toYear) {
      throw new Error("Start year cannot be later than end year.");
    }
    const filter = { genre: new RegExp(`(?:^|,\\s*)${escapeRegExp(genre)}(?:,|$)`, "i") };
    if (fromYear !== undefined || toYear !== undefined) {
      filter.year = {};
      if (fromYear !== undefined) filter.year.$gte = fromYear;
      if (toYear !== undefined) filter.year.$lte = toYear;
    }
    const movies = await db.collection("movies")
      .find(filter, { projection: { _id: 0 } })
      .sort({ rating: -1, year: -1 })
      .limit(10)
      .toArray();
    return {
      kind: "movies",
      action,
      movies: movies.map(movieCard),
      message: movies.length
        ? `Recommendations from ${genre} movies cached in the database.`
        : `No cached ${genre} movies matched that year range. Look up a movie first to add it to recommendations.`,
    };
  }
  if (action !== "lookup") {
    throw new Error("Movie action must be lookup or recommend.");
  }

  const title = assertString(args.title, "Movie title", 120);
  const year = optionalInteger(args.year, "Year", 1888, 2200);
  if (!apiKey) {
    throw new Error("OMDb lookup is unavailable. Set OMDB_API_KEY in the app's .env file.");
  }

  const requestOptions = { fetchImpl, attempts, retryDelayMs };
  let details;
  let exactFailure;
  try {
    details = assertOmdbSuccess(await requestOmdb({ t: title, y: year, plot: "full" }, apiKey, requestOptions));
  } catch (error) {
    if (!/movie not found/i.test(error.message)) throw error;
    exactFailure = error;
  }

  if (!details) {
    const searchResult = assertOmdbSuccess(await requestOmdb({ s: title, y: year }, apiKey, requestOptions));
    const matches = Array.isArray(searchResult.Search) ? searchResult.Search.slice(0, 5) : [];
    if (!matches.length) {
      throw exactFailure ?? new Error("OMDb did not find a matching movie.");
    }
    const detailedMatches = await Promise.all(matches.map(async (match) => {
      const result = assertOmdbSuccess(
        await requestOmdb({ i: match.imdbID, plot: "full" }, apiKey, requestOptions),
      );
      return cacheMovie(db, movieFromOmdb(result));
    }));
    return {
      kind: "movies",
      action,
      movies: detailedMatches.map(movieCard),
      message: `Showing partial title matches for “${title}”.`,
    };
  }

  const movie = await cacheMovie(db, movieFromOmdb(details));
  return {
    kind: "movies",
    action,
    movies: [movieCard(movie)],
    message: `Movie details for ${movie.title} (${movie.year}); cached for future recommendations.`,
  };
}

const jokeCategories = new Set(["dad", "programming", "general"]);

function validateJokeCategory(category) {
  const value = category ?? "dad";
  if (!jokeCategories.has(value)) {
    throw new Error("Joke category must be dad, programming, or general.");
  }
  return value;
}

function jokeResult(jokes, message) {
  return {
    kind: "jokes",
    jokes: jokes.map((joke) => ({
      id: joke.id,
      text: joke.text,
      category: joke.category,
      source: joke.source,
      votes: joke.votes,
    })),
    message,
  };
}

async function storedJokes(db, category, keyword) {
  const filter = {};
  if (category) filter.category = category;
  if (keyword) filter.$text = { $search: keyword };
  return db.collection("jokes").find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();
}

async function fetchDadJoke(db, requestOptions) {
  const data = await fetchJsonWithRetry("https://icanhazdadjoke.com/", {
    headers: { Accept: "application/json" },
  }, requestOptions);
  if (typeof data?.id !== "string" || typeof data?.joke !== "string" || !data.joke.trim()) {
    throw new Error("The joke service returned an invalid response.");
  }
  const joke = {
    id: `icanhaz-${data.id}`,
    text: data.joke.trim(),
    category: "dad",
    source: "icanhazdadjoke.com",
    votes: { up: 0, down: 0 },
    createdAt: new Date(),
  };
  await db.collection("jokes").updateOne(
    { id: joke.id },
    { $setOnInsert: joke },
    { upsert: true },
  );
  return { ...joke, ...(await db.collection("jokes").findOne({ id: joke.id })) };
}

export async function jokeTool(db, args = {}, {
  fetchImpl = fetch,
  attempts,
  retryDelayMs,
} = {}) {
  const action = args.action ?? "random";
  const category = validateJokeCategory(args.category);
  const requestOptions = { fetchImpl, attempts, retryDelayMs };

  if (action === "rate") {
    const id = assertString(args.id, "Joke ID", 120);
    if (args.vote !== "up" && args.vote !== "down") {
      throw new Error("Vote must be up or down.");
    }
    const collection = db.collection("jokes");
    const result = await collection.updateOne(
      { id },
      { $inc: { [`votes.${args.vote}`]: 1 } },
    );
    if (result.matchedCount !== 1) {
      throw new Error("That joke is no longer available to rate.");
    }
    const joke = await collection.findOne({ id }, { projection: { _id: 0 } });
    return jokeResult([joke], "Thanks for rating this joke.");
  }

  if (action === "search") {
    const keyword = assertString(args.keyword, "Search keyword", 100);
    const jokes = await storedJokes(db, category, keyword);
    return jokeResult(jokes, jokes.length
      ? `Found ${jokes.length} ${category} joke(s) matching “${keyword}”.`
      : `No stored ${category} jokes matched “${keyword}”.`);
  }

  if (action !== "random") {
    throw new Error("Joke action must be random, search, or rate.");
  }

  if (category === "dad") {
    try {
      const joke = await fetchDadJoke(db, requestOptions);
      return jokeResult([joke], "A fresh dad joke from icanhazdadjoke.com.");
    } catch (error) {
      const fallback = await storedJokes(db, category);
      if (fallback.length) {
        return jokeResult([fallback[Math.floor(Math.random() * fallback.length)]],
          `The joke service was unavailable; showing a saved joke instead. (${error.message})`);
      }
      throw new Error(`The joke service failed and no saved dad jokes are available: ${error.message}`);
    }
  }

  const jokes = await storedJokes(db, category);
  if (!jokes.length) {
    return jokeResult([], `No saved ${category} jokes are available yet.`);
  }
  return jokeResult([jokes[Math.floor(Math.random() * jokes.length)]], `A saved ${category} joke.`);
}

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "database_query",
      description: "Answer read-only questions about movies, users, and reviews. Use age_above for 'over age', rating_above for 'rating above', min_rating for 'at least', and rating_below for 'below'. Supports genre, title, year and review filters, plus movie counts by genre.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          entity: { type: "string", enum: ["movies", "users", "reviews"] },
          action: { type: "string", enum: ["search", "count_by_genre"] },
          genre: { type: "string" },
          title: { type: "string" },
          min_age: { type: "number" },
          age_above: { type: "number" },
          max_age: { type: "number" },
          min_rating: { type: "number" },
          rating_above: { type: "number" },
          rating_below: { type: "number" },
          max_rating: { type: "number" },
          min_year: { type: "number" },
          max_year: { type: "number" },
          movie_id: { type: "string" },
          user_id: { type: "string" },
          page: { type: "integer" },
          limit: { type: "integer" },
        },
        required: ["entity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "movie_lookup",
      description: "Look up movie details by title and optional year from OMDb, including plot, cast, ratings, poster and runtime. Partial title matches are supported. Recommend movies by genre and optional year range from the MongoDB cache.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["lookup", "recommend"] },
          title: { type: "string" },
          year: { type: "integer" },
          genre: { type: "string" },
          from_year: { type: "integer" },
          to_year: { type: "integer" },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "jokes",
      description: "Get a random joke, search stored jokes by keyword, or rate a joke. Categories are dad, programming, and general. Fresh dad jokes come from icanhazdadjoke.com and are cached.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["random", "search", "rate"] },
          category: { type: "string", enum: ["dad", "programming", "general"] },
          keyword: { type: "string" },
          id: { type: "string" },
          vote: { type: "string", enum: ["up", "down"] },
        },
        required: [],
      },
    },
  },
];

export async function executeTool(db, name, args) {
  if (name === "database_query") return queryDatabase(db, args);
  if (name === "movie_lookup") return movieTool(db, args);
  if (name === "jokes") return jokeTool(db, args);
  throw new Error(`Unknown tool: ${name}`);
}
