// This code is designed to be deployed as a Vercel Serverless Function (Node.js)
// Filepath: api/gemini-move.js

// Import required modules (standard Node.js 'fetch' is usually available on Vercel)
// If running locally or on a different runtime, you might need: const fetch = require('node-fetch');

// Gemini Model Configuration
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL_NAME = 'gemini-2.5-flash-preview-09-2025'; // Default model for chess advice

// System instruction to guide the model's output
const SYSTEM_INSTRUCTION = `You are a world-class chess engine. Your sole task is to analyze the current board state (provided as a FEN string) and respond ONLY with the best move in Standard Algebraic Notation (SAN), without any surrounding text, markdown, or explanation. The response must be a single, valid chess move (e.g., 'e4', 'Nf3', 'Qxg7'). Do not use move tokens (e.g., e2e4) unless necessary for ambiguity.`;

// Utility function for exponential backoff retry
async function fetchWithRetry(url, options, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429) { // Rate limit error
                throw new Error('Rate limit exceeded');
            }
            if (!response.ok) {
                // Read the response body for detailed API error message
                const errorBody = await response.text();
                throw new Error(`HTTP error! status: ${response.status}. Body: ${errorBody}`);
            }
            return response;
        } catch (error) {
            if (i === maxRetries - 1) throw error;
            const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
            console.warn(`Fetch attempt ${i + 1} failed. Retrying in ${Math.round(delay)}ms. Error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Vercel Serverless Function Handler
export default async function handler(request, response) {
    // 1. CORS Headers for security and cross-origin calls
    // It's recommended to restrict Access-Control-Allow-Origin in production
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Handle pre-flight CORS requests
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // Ensure it's a POST request
    if (request.method !== 'POST') {
        return response.status(405).json({ error: 'Method Not Allowed. Use POST.' });
    }

    // Check for API Key
    // NOTE: This relies on the environment variable being set in your Vercel deployment.
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
        console.error("GEMINI_API_KEY environment variable is NOT set.");
        return response.status(500).json({ error: 'Server configuration error: Gemini API Key is missing.' });
    }

    let fen;
    try {
        // Parse the incoming JSON body
        const body = request.body;
        fen = body.fen;
        
        if (!fen) {
            return response.status(400).json({ error: 'Missing FEN string in request body.' });
        }

    } catch (e) {
        return response.status(400).json({ error: 'Invalid JSON request body.' });
    }
    
    // Construct the prompt for the Gemini model
    // We rely on the FEN string (which includes the side to move) and the strong SYSTEM_INSTRUCTION.
    const userPrompt = `Analyze the current board state provided by this FEN string and give the single best move: ${fen}`;

    const apiUrl = `${GEMINI_API_BASE}${MODEL_NAME}:generateContent?key=${geminiApiKey}`;

    const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        // FIX: 'config' should be 'generationConfig' for the parameters
        generationConfig: {
            // Set temperature low for deterministic, "best" chess moves
            temperature: 0.1, 
        }
    };

    try {
        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        };

        const apiResponse = await fetchWithRetry(apiUrl, fetchOptions);
        const result = await apiResponse.json();

        const candidate = result.candidates?.[0];
        
        if (!candidate || !candidate.content?.parts?.[0]?.text) {
            // Check for API error messages
            const errorMessage = result.error?.message || 'Gemini returned an empty or invalid response.';
            console.error("Gemini API Error Response:", JSON.stringify(result, null, 2));
            return response.status(502).json({ error: `Gemini API Error: ${errorMessage}` });
        }

        // The text should be the raw move string (e.g., "Nf6" or "e4")
        const rawMove = candidate.content.parts[0].text.trim();
        
        // Basic sanitation: take the first word/token and remove any quotes/markdown wrappers
        const cleanedMove = rawMove.split(/\s/)[0].replace(/['"`.]/g, '');

        console.log(`FEN: ${fen} -> Move: ${cleanedMove}`);

        // Send the move back to the frontend
        return response.status(200).json({ move: cleanedMove });

    } catch (error) {
        console.error('Error during API call:', error);
        return response.status(500).json({ error: 'Failed to communicate with the Gemini API.', details: error.message });
    }
}