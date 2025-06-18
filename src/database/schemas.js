// src/database/schemas.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

// Schema for Bot Settings (per server or per user for DM)
const BotSettingsSchema = new Schema({
    _id: { type: String, required: true }, // Server ID or User ID (for DMs)
    isDM: { type: Boolean, default: false }, // true if for DM, false if for server
    name: { type: String, default: 'Kohana Yuki', maxlength: 10 },
    age: { type: String, default: '15' }, // Stored as string to allow flexible inputs
    gender: { type: String, default: 'female', enum: ['male', 'female', 'transgender'] },
    mood: { type: String, default: 'happy' }, // Comma-separated list for options, but stored as string
    customInstructions: { type: String, default: '', maxlength: 1000 },
    defaultInstructions: { type: String, default: "I'm Kohana Yuki, I live in Tokyo, and I like to watch anime and play games. I consider myself a human.", maxlength: 1000 },
    imageGenerationEnabled: { type: Boolean, default: false },
    webSearchEnabled: { type: Boolean, default: false },
    allowedChannels: { type: [String], default: [] } // Array of channel IDs where bot is allowed to chat
}, { timestamps: true });

// Schema for Chat History (per server-user or per DM user)
const ChatHistorySchema = new Schema({
    botContextId: { type: String, required: true }, // Server ID or DM User ID
    userId: { type: String, required: true }, // User ID who sent the message
    isDM: { type: Boolean, default: false }, // true if for DM, false if for server
    history: [{
        role: { type: String, required: true, enum: ['user', 'bot'] },
        parts: [{ text: { type: String, required: true } }]
    }]
}, { timestamps: true });

const BotSettings = mongoose.model('BotSettings', BotSettingsSchema);
const ChatHistory = mongoose.model('ChatHistory', ChatHistorySchema);

module.exports = { BotSettings, ChatHistory };
