const Guild = require('../models/Guild');
const User = require('../models/User');
const { generateContent, shouldReply, generateImage } = require('../config/gemini');
const { createDirectoryStructure, getRandomGif } = require('../utils/helpers');

const handleMessage = async (message) => {
    if (message.author.bot) return;

    const isGuild = message.guild !== null;
    const isDM = !isGuild;
    
    let guildSettings = null;
    
    if (isGuild) {
        guildSettings = await Guild.findOne({ guildId: message.guild.id });
        if (!guildSettings) return;
        
        if (guildSettings.allowedChannels.length > 0 && 
            !guildSettings.allowedChannels.includes(message.channel.id)) {
            return;
        }
    }

    let user = await User.findOne({ userId: message.author.id });
    if (!user) {
        user = new User({
            userId: message.author.id,
            username: message.author.username
        });
        await user.save();
        
        if (isDM) {
            await createDirectoryStructure('Users', message.author.username);
        }
    }

    const botName = guildSettings ? guildSettings.botName : 'Kohana';
    const imageGenEnabled = guildSettings ? guildSettings.imageGeneration : true;
    
    const imageGenPattern = new RegExp(`hi\\s+${botName}\\s+can\\s+you\\s+draw\\s+a\\s+(.+?)\\s+for\\s+me\\??`, 'i');
    const imageMatch = message.content.match(imageGenPattern);
    
    if (imageMatch && imageGenEnabled) {
        const prompt = imageMatch[1];
        
        message.channel.sendTyping();
        
        try {
            const imageResponse = await generateImage(prompt);
            await message.reply(`Here's your ${prompt}! 🎨`);
        } catch (error) {
            await message.reply("Sorry, I couldn't generate that image right now. Please try again later!");
        }
        return;
    }

    const isMentioned = message.mentions.has(message.client.user);
    const isReply = message.reference && message.reference.messageId;
    
    const messages = message.content.split(',').map(msg => msg.trim()).filter(msg => msg.length > 0);
    
    for (const msg of messages) {
        let shouldRespond = false;
        
        if (isMentioned || isReply) {
            shouldRespond = Math.random() > 0.5;
        } else {
            shouldRespond = await shouldReply(msg);
        }
        
        if (shouldRespond) {
            message.channel.sendTyping();
            
            const context = await buildContext(user, guildSettings, msg);
            
            try {
                const response = await generateContent(context);
                
                setTimeout(async () => {
                    await message.reply(response);
                    
                    if (Math.random() > 0.8) {
                        const gif = await getRandomGif();
                        if (gif) {
                            await message.channel.send(gif);
                        }
                    }
                }, Math.random() * 2000 + 1000);
                
                user.conversationHistory.push({
                    message: msg,
                    timestamp: new Date(),
                    guildId: message.guild ? message.guild.id : null
                });
                
                if (user.conversationHistory.length > 50) {
                    user.conversationHistory = user.conversationHistory.slice(-30);
                }
                
                user.lastInteraction = new Date();
                await user.save();
                
            } catch (error) {
                console.error('Error generating response:', error);
                await message.reply("Sorry, I'm having trouble thinking right now. Can you try again?");
            }
            
            break;
        }
    }
};

const buildContext = async (user, guildSettings, message) => {
    const botName = guildSettings ? guildSettings.botName : 'Kohana';
    const botAge = guildSettings ? guildSettings.botAge : 15;
    const botGender = guildSettings ? guildSettings.botGender : 'female';
    const botMood = guildSettings ? guildSettings.botMood.join(', ') : 'cheerful, friendly';
    
    let context = `You are ${botName}, a ${botAge}-year-old ${botGender} from Tokyo who loves watching anime and playing games. `;
    context += `Your current mood is: ${botMood}. `;
    context += `You behave like a real human, not an AI. Be natural, casual, and engaging. `;
    
    if (guildSettings && guildSettings.customPersonality) {
        context += `Personality override: ${guildSettings.customPersonality} `;
    }
    
    if (guildSettings && guildSettings.customBehavior) {
        context += `Behavior instructions: ${guildSettings.customBehavior} `;
    }
    
    if (user.preferences.customInstructions) {
        context += `User-specific instructions: ${user.preferences.customInstructions} `;
    }
    
    if (user.preferences.preferredName) {
        context += `Address this user as: ${user.preferences.preferredName} `;
    }
    
    const recentHistory = user.conversationHistory.slice(-5);
    if (recentHistory.length > 0) {
        context += `Recent conversation context: `;
        recentHistory.forEach(entry => {
            context += `User said: "${entry.message}" `;
        });
    }
    
    context += `\n\nUser's current message: "${message}"\n\nRespond naturally as ${botName}:`;
    
    return context;
};

module.exports = { handleMessage };
