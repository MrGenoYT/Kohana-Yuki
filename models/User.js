const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    username: {
        type: String,
        required: true
    },
    preferences: {
        mood: {
            type: [String],
            default: []
        },
        customInstructions: {
            type: String,
            maxlength: 1000,
            default: ''
        },
        preferredName: {
            type: String,
            default: ''
        }
    },
    conversationHistory: [{
        message: String,
        timestamp: Date,
        guildId: String
    }],
    lastInteraction: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('User', userSchema);
