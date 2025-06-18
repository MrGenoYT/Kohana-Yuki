// src/ai/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fetch = require('node-fetch'); // For fetching images for OCR

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Initialize GoogleGenerativeAI
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Get a model instance for text and multimodal content
const textModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
const imageGenModel = genAI.getGenerativeModel({ model: "imagen-3.0-generate-002" });

// Function to generate text response
const generateText = async (systemPrompt, userPrompt, chatHistory = [], imageBase64 = null) => {
    try {
        const fullChatHistory = [];

        // Add system prompt as initial user context if it's new, otherwise implicitly through user messages
        fullChatHistory.push({ role: "user", parts: [{ text: systemPrompt }] });
        fullChatHistory.push({ role: "model", parts: [{ text: "Okay, I understand." }] }); // Acknowledge system prompt

        // Add historical messages
        chatHistory.forEach(msg => {
            if (msg.role === 'user' || msg.role === 'bot') { // Ensure roles are valid for Gemini
                fullChatHistory.push({ role: msg.role === 'user' ? 'user' : 'model', parts: msg.parts });
            }
        });

        const contents = [];
        if (imageBase64) {
            contents.push({
                role: "user",
                parts: [
                    { text: userPrompt },
                    {
                        inlineData: {
                            mimeType: "image/png", // Assuming PNG, adjust if needed
                            data: imageBase64
                        }
                    }
                ]
            });
        } else {
            contents.push({ role: "user", parts: [{ text: userPrompt }] });
        }


        const payload = {
            contents: [...fullChatHistory, ...contents],
            generationConfig: {
                temperature: 0.8, // Adjust creativity
                topP: 0.9,
                topK: 40,
            }
        };

        const apiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
            const text = result.candidates[0].content.parts[0].text;
            return text;
        } else {
            console.error("Unexpected Gemini API response structure:", JSON.stringify(result, null, 2));
            return "Sorry, I couldn't generate a response. The AI might be having trouble.";
        }
    } catch (error) {
        console.error('Error calling Gemini API for text generation:', error);
        return 'I apologize, but I encountered an error while processing your request.';
    }
};

// Function to generate image
const generateImage = async (prompt) => {
    try {
        const payload = { instances: { prompt: prompt }, parameters: { "sampleCount": 1 } };
        const apiKey = process.env.GEMINI_API_KEY;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
            const imageUrl = `data:image/png;base64,${result.predictions[0].bytesBase64Encoded}`;
            return imageUrl;
        } else {
            console.error("Unexpected Image Generation API response structure:", JSON.stringify(result, null, 2));
            return null;
        }
    } catch (error) {
        console.error('Error calling Image Generation API:', error);
        return null;
    }
};

// Function to decide if the bot should reply based on AI analysis
const decideToReply = async (systemPrompt, userPrompt, chatHistory) => {
    try {
        const chat = textModel.startChat({
            history: chatHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: msg.parts
            })),
            generationConfig: {
                temperature: 0.1, // Keep low for deterministic decision
            },
        });

        const prompt = `${systemPrompt} Given the last user message: "${userPrompt}", should I, as Kohana Yuki, respond? Answer only with "YES" or "NO".`;

        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        const text = response.text().trim().toUpperCase();

        return text.includes('YES');
    } catch (error) {
        console.error('Error deciding to reply:', error);
        return true; // Default to replying if decision fails
    }
};

module.exports = { generateText, generateImage, decideToReply };

