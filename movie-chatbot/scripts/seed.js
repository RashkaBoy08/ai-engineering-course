import "dotenv/config";
import { connectDatabase } from "../src/database.js";

const movies = [
  {
    id: "sample-matrix",
    title: "The Matrix",
    year: 1999,
    genre: "Sci-Fi",
    rating: 8.7,
    director: "Lana Wachowski, Lilly Wachowski",
    description: "A hacker learns the world he knows is a simulated reality.",
    poster: "https://m.media-amazon.com/images/M/MV5BNzQzOTk3NDYtYzQ3MS00N2Q4LTk5MDYtYjY2YTYzYjQxZTE4XkEyXkFqcGc@._V1_SX300.jpg",
    runtime: "136 min",
    cast: ["Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-interstellar",
    title: "Interstellar",
    year: 2014,
    genre: "Sci-Fi",
    rating: 8.7,
    director: "Christopher Nolan",
    description: "Explorers travel beyond this galaxy to discover whether mankind has a future among the stars.",
    poster: "https://m.media-amazon.com/images/M/MV5BZjdkOTU3MDgtN2Q5ZC00ZWI0LTljOTMtYzU4YjFiNjY2Y2YxXkEyXkFqcGc@._V1_SX300.jpg",
    runtime: "169 min",
    cast: ["Matthew McConaughey", "Anne Hathaway", "Jessica Chastain"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-arrival",
    title: "Arrival",
    year: 2016,
    genre: "Sci-Fi",
    rating: 7.9,
    director: "Denis Villeneuve",
    description: "A linguist works with the military to communicate with alien visitors.",
    poster: null,
    runtime: "116 min",
    cast: ["Amy Adams", "Jeremy Renner", "Forest Whitaker"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-inception",
    title: "Inception",
    year: 2010,
    genre: "Sci-Fi",
    rating: 8.8,
    director: "Christopher Nolan",
    description: "A skilled thief enters people's dreams to steal secrets and plant an idea.",
    poster: null,
    runtime: "148 min",
    cast: ["Leonardo DiCaprio", "Joseph Gordon-Levitt", "Elliot Page"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-godfather",
    title: "The Godfather",
    year: 1972,
    genre: "Crime",
    rating: 9.2,
    director: "Francis Ford Coppola",
    description: "The aging patriarch of a crime dynasty transfers control to his reluctant son.",
    poster: null,
    runtime: "175 min",
    cast: ["Marlon Brando", "Al Pacino", "James Caan"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-back-to-the-future",
    title: "Back to the Future",
    year: 1985,
    genre: "Adventure",
    rating: 8.5,
    director: "Robert Zemeckis",
    description: "A teenager travels back in time and must ensure his parents meet.",
    poster: null,
    runtime: "116 min",
    cast: ["Michael J. Fox", "Christopher Lloyd", "Lea Thompson"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
  {
    id: "sample-toy-story",
    title: "Toy Story",
    year: 1995,
    genre: "Animation",
    rating: 8.3,
    director: "John Lasseter",
    description: "A group of toys comes to life when people are not around.",
    poster: null,
    runtime: "81 min",
    cast: ["Tom Hanks", "Tim Allen", "Don Rickles"],
    omdbRatings: [],
    cachedAt: new Date(),
  },
];

const users = [
  { id: "user-1", name: "Alex Morgan", email: "alex@example.com", age: 29, favorite_genre: "Sci-Fi" },
  { id: "user-2", name: "Jamie Lee", email: "jamie@example.com", age: 24, favorite_genre: "Comedy" },
  { id: "user-3", name: "Sam Rivera", email: "sam@example.com", age: 36, favorite_genre: "Crime" },
  { id: "user-4", name: "Taylor Kim", email: "taylor@example.com", age: 31, favorite_genre: "Animation" },
];

const reviews = [
  { id: "review-1", movie_id: "sample-matrix", user_id: "user-1", rating: 10, comment: "A brilliant sci-fi classic.", date: new Date("2024-01-15") },
  { id: "review-2", movie_id: "sample-interstellar", user_id: "user-1", rating: 9, comment: "Beautiful and ambitious.", date: new Date("2024-02-20") },
  { id: "review-3", movie_id: "sample-godfather", user_id: "user-3", rating: 10, comment: "An unforgettable crime drama.", date: new Date("2024-03-08") },
  { id: "review-4", movie_id: "sample-toy-story", user_id: "user-4", rating: 8, comment: "Still delightful to watch.", date: new Date("2024-04-04") },
];

const jokes = [
  {
    id: "seed-dad-1",
    text: "Why did the scarecrow win an award? Because he was outstanding in his field.",
    category: "dad",
    source: "sample data",
    votes: { up: 0, down: 0 },
    createdAt: new Date(),
  },
  {
    id: "seed-programming-1",
    text: "Why do programmers prefer dark mode? Because light attracts bugs.",
    category: "programming",
    source: "sample data",
    votes: { up: 0, down: 0 },
    createdAt: new Date(),
  },
  {
    id: "seed-general-1",
    text: "I used to play piano by ear, but now I use my hands.",
    category: "general",
    source: "sample data",
    votes: { up: 0, down: 0 },
    createdAt: new Date(),
  },
];

async function seed() {
  let connection;
  try {
    connection = await connectDatabase(
      process.env.MONGODB_URI,
      process.env.MONGODB_DATABASE ?? "movie_chatbot",
    );
    const { db } = connection;
    for (const [collectionName, records] of [
      ["movies", movies],
      ["users", users],
      ["reviews", reviews],
      ["jokes", jokes],
    ]) {
      await db.collection(collectionName).bulkWrite(records.map((record) => ({
        updateOne: {
          filter: { id: record.id },
          update: { $setOnInsert: record },
          upsert: true,
        },
      })));
    }
    console.log("MongoDB collections and indexes are ready; sample data is available.");
  } catch (error) {
    console.error(`\nDatabase seeding failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await connection?.client.close();
  }
}

seed();
