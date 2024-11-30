require("dotenv").config();
const express = require("express");
const { OpenAI } = require("openai"); 
const { MongoClient } = require("mongodb");
const bodyParser = require("body-parser");

const app = express();
const port = process.env.PORT || 3000;

// Configure OpenAI API
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// MongoDB setup
const client = new MongoClient(process.env.MONGO_URI);
let db;

// Middleware
app.use(bodyParser.json());

// Connect to MongoDB
(async () => {
  try {
    await client.connect();
    db = client.db("sellcallput");
    console.log("Connected to MongoDB");
  } catch (err) {
    console.error("Error connecting to MongoDB:", err);
  }
})();

// Endpoint to add words and generate vectors
app.post("/add-words", async (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words) || words.length === 0) {
    return res.status(400).json({ error: "Invalid input. Provide an array of words." });
  }

  try {
    const promises = words.map(async (word) => {
      const embedding = 
      await openai.embeddings.create({
        model: "text-embedding-ada-002",
        input: word,
      });
      return {
        word,
        vector: embedding.data[0].embedding,
      };
    });

    const wordData = await Promise.all(promises);
    await db.collection("words").insertMany(wordData);

    res.status(201).json({ message: "Words added successfully", data: wordData });
  } catch (err) {
    console.error("Error adding words:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Endpoint to find synonyms
app.get("/find-synonym/:word", async (req, res) => {
  const { word } = req.params;

  try {
    const embedding = await openai.embeddings.create({
      model: "text-embedding-ada-002",
      input: word,
    });

    const queryVector = embedding.data[0].embedding;

    // Calculate cosine similarity and find the closest word
    const words = await db.collection("words").find().toArray();

    const calculateCosineSimilarity = (vec1, vec2) => {
      const dotProduct = vec1.reduce((sum, v, i) => sum + v * vec2[i], 0);
      const magnitude1 = Math.sqrt(vec1.reduce((sum, v) => sum + v * v, 0));
      const magnitude2 = Math.sqrt(vec2.reduce((sum, v) => sum + v * v, 0));
      return dotProduct / (magnitude1 * magnitude2);
    };

    const bestMatch = words.reduce(
      (best, item) => {
        const similarity = calculateCosineSimilarity(queryVector, item.vector);
        return similarity > best.similarity ? { word: item.word, similarity } : best;
      },
      { word: null, similarity: -1 }
    );

    if (bestMatch.similarity > 0.85) {
      res.json({ synonym: bestMatch.word });
    } else {
      res.json({ synonym: "No close match found." });
    }
  } catch (err) {
    console.error("Error finding synonym:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
