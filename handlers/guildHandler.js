const Guild = require('../models/Guild');
const { createDirectoryStructure, generateUniqueId } = require('../utils/helpers');

const handleGuildJoin = async (guild) => {
    try {
        const uniqueId = generateUniqueId();
        
        const guildSettings = new Guild({
            guildId: guild.id,
            uniqueId: uniqueId
        });
        
        await guildSettings.save();
        await createDirectoryStructure('Servers', uniqueId);
        
        const role = await guild.roles.create({
            name: 'Kohana',
            color: 'Red',
            reason: 'Bot role creation'
        });
        
        guildSettings.roleId = role.id;
        await guildSettings.save();
        
        const botMember = guild.members.cache.get(guild.client.user.id);
        if (botMember) {
            await botMember.roles.add(role);
        }
        
        console.log(`Joined guild: ${guild.name} (${guild.id})`);
        
    } catch (error) {
        console.error('Error handling guild join:', error);
    }
};

module.exports = { handleGuildJoin };
