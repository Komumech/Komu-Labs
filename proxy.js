// Install dependencies: npm install express cors dotenv
const express = require('express');
const cors = require('cors');
require('dotenv').config(); // Loads environment variables from .env file
const fetch = require('node-fetch'); // Use for server-side fetching

const app = express();
const PORT = 3000;

// 1. Enable CORS for all origins (or restrict to your specific frontend URL)
app.use(cors());

// Body parser for JSON requests
app.use(express.json());

// **CRITICAL SECURITY STEP:** Get API Key from a secure environment variable
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

if (!GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY is not set in environment variables or .env file.");
    process.exit(1);
}

// 2. Define the endpoint your frontend will call
app.post('/api/gemini-move', async (req, res) => {
    try {
        // The prompt is passed from the client in the request body
        const { prompt, model } = req.body;
        
        if (!prompt || !model) {
            return res.status(400).json({ error: "Missing 'prompt' or 'model' in request body." });
        }

        // 3. Forward the request to the Gemini API, securely injecting the key
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
        
        const geminiResponse = await fetch(geminiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 64 }
            })
        });

        const data = await geminiResponse.json();
        
        // 4. Send the Gemini response back to the client
        res.json(data);

    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: error.message || "An unknown error occurred in the proxy." });
    }
});

app.listen(PORT, () => {
    console.log(`Proxy server running on http://localhost:${PORT}`);
    console.log("Connect your frontend to this server's /api/gemini-move endpoint.");
});