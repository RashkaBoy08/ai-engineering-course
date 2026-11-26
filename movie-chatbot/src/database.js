import { MongoClient } from "mongodb";

const validators = {
  movies: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "title", "year", "genre", "rating", "director", "description"],
      properties: {
        id: { bsonType: "string" },
        title: { bsonType: "string", minLength: 1 },
        year: { bsonType: ["int", "long", "double"], minimum: 1888 },
        genre: { bsonType: "string" },
        rating: { bsonType: ["int", "long", "double", "null"], minimum: 0, maximum: 10 },
        director: { bsonType: "string" },
        description: { bsonType: "string" },
        poster: { bsonType: ["string", "null"] },
        runtime: { bsonType: ["string", "null"] },
        cast: { bsonType: "array", items: { bsonType: "string" } },
        omdbRatings: { bsonType: "array" },
        imdbId: { bsonType: ["string", "null"] },
        cachedAt: { bsonType: "date" },
      },
    },
  },
  users: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "name", "email", "age", "favorite_genre"],
      properties: {
        id: { bsonType: "string" },
        name: { bsonType: "string", minLength: 1 },
        email: { bsonType: "string", pattern: "^.+@.+\\..+$" },
        age: { bsonType: ["int", "long"], minimum: 1, maximum: 120 },
        favorite_genre: { bsonType: "string" },
      },
    },
  },
  reviews: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "movie_id", "user_id", "rating", "comment", "date"],
      properties: {
        id: { bsonType: "string" },
        movie_id: { bsonType: "string" },
        user_id: { bsonType: "string" },
        rating: { bsonType: ["int", "long", "double"], minimum: 0, maximum: 10 },
        comment: { bsonType: "string" },
        date: { bsonType: "date" },
      },
    },
  },
  jokes: {
    $jsonSchema: {
      bsonType: "object",
      required: ["id", "text", "category", "votes", "createdAt"],
      properties: {
        id: { bsonType: "string" },
        text: { bsonType: "string", minLength: 1 },
        category: { enum: ["dad", "programming", "general"] },
        source: { bsonType: "string" },
        votes: {
          bsonType: "object",
          required: ["up", "down"],
          properties: {
            up: { bsonType: ["int", "long"], minimum: 0 },
            down: { bsonType: ["int", "long"], minimum: 0 },
          },
        },
        createdAt: { bsonType: "date" },
      },
    },
  },
};

const indexes = {
  movies: [
    [{ id: 1 }, { unique: true }],
    [{ title: 1 }],
    [{ genre: 1, year: -1 }],
    [{ rating: -1 }],
    [{ imdbId: 1 }, { sparse: true, unique: true }],
  ],
  users: [
    [{ id: 1 }, { unique: true }],
    [{ age: 1 }],
    [{ favorite_genre: 1 }],
  ],
  reviews: [
    [{ id: 1 }, { unique: true }],
    [{ movie_id: 1, date: -1 }],
    [{ user_id: 1 }],
  ],
  jokes: [
    [{ id: 1 }, { unique: true }],
    [{ category: 1, createdAt: -1 }],
    [{ text: "text" }],
  ],
  conversations: [
    [{ id: 1 }, { unique: true }],
    [{ userId: 1, updatedAt: -1 }],
  ],
  preferences: [[{ userId: 1 }, { unique: true }]],
  tool_usage: [[{ userId: 1, createdAt: -1 }], [{ tool: 1, createdAt: -1 }]],
};

const requiredCollections = [
  "movies",
  "users",
  "reviews",
  "jokes",
  "conversations",
  "preferences",
  "tool_usage",
];

export async function initializeDatabase(db) {
  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name),
  );
  for (const name of requiredCollections) {
    if (!existing.has(name)) {
      await db.createCollection(name, validators[name] ? { validator: validators[name] } : {});
    } else if (validators[name]) {
      await db.command({
        collMod: name,
        validator: validators[name],
        validationLevel: "strict",
        validationAction: "error",
      });
    }

    for (const [specification, options] of indexes[name] ?? []) {
      await db.collection(name).createIndex(specification, options);
    }
  }
}

export async function connectDatabase(uri, databaseName) {
  if (!uri || !databaseName) {
    throw new Error("Set MONGODB_URI and MONGODB_DATABASE before starting the app.");
  }

  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  try {
    await client.connect();
    const db = client.db(databaseName);
    await initializeDatabase(db);
    return { client, db };
  } catch (error) {
    await client.close();
    throw error;
  }
}
