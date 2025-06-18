const mongoose = require('mongoose');

const guildSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        unique: true
    },
    botName: {
        type: String,
        default: 'Kohana',
        maxlength: 10
    },
    botAge: {
        type: Number,
        default: 15
    },
    botGender: {
        type: String,
        enum: ['male', 'female', 'transgender'],
        default: 'female'
    },
    botMood: {
        type: [String],
        default: ['cheerful', 'friendly']
    },
    customBehavior: {
        type: String,
        maxlength: 1000,
        default: ''
    },
    customPersonality: {
        type: String,
        maxlength: 1000,
        default: ''
    },
    imageGeneration: {
        type: Boolean,
        default: false
    },
    webSearch: {
        type: Boolean,
        default: false
    },
    allowedChannels: [{
        type: String
    }],
    roleId: {
        type: String,
        default: null
    },
    uniqueId: {
        type: String,
        required: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Guild', guildSchema);
