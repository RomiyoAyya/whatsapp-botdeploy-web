const { getUserData, saveUserData, generateAIResponse } = require('../utils');
const { shouldSendSticker, analyzeMessageSentiment, generateStickerImage, createWhatsAppSticker } = require('./stickerUtils');

/**
 * Determines if the bot should initiate a conversation with the user
 * @param {Object} userData - User data
 * @returns {boolean} - Whether to send a self-message
 */
function shouldSendSelfMessage(userData) {
    // Initialize chat activity tracking if it doesn't exist
    if (!userData.chatActivity) {
        userData.chatActivity = {
            lastUserMessageTime: Date.now(),
            lastBotInitiatedTime: 0,
            activeHours: Array(24).fill(0),
            messageCount: 0,
            selfMessagesSent: 0
        };
    }
    
    const now = Date.now();
    const hourOfDay = new Date().getHours();
    
    // Don't send if user has messaged in the last 30 minutes
    const inactivityThreshold = 30 * 60 * 1000;
    if (userData.chatActivity.lastUserMessageTime > (now - inactivityThreshold)) {
        return false;
    }
    // Don't send if we've already sent a self-message in the last 6 hours
    const minTimeBetweenMessages = 6 * 60 * 60 * 1000;
    if (userData.chatActivity.lastBotInitiatedTime > (now - minTimeBetweenMessages)) {
        return false;
    }
    
    // Don't send if we've already sent too many consecutive messages
    if (userData.chatActivity.selfMessagesSent >= 2) {
        return false;
    }
    
    // Check if current hour is an active hour for this user
    let isActiveHour = false;
    if (userData.chatActivity.activeHours && userData.chatActivity.activeHours[hourOfDay] > 0) {
        isActiveHour = true;
    }
    
    // Higher chance during active hours
    const randomChance = Math.random();
    if (isActiveHour && randomChance < 0.7) {
        return true;
    } else if (randomChance < 0.4) {
        return true;
    }
    
    return false;
}

/**
 * Generates a self-message based on user memory
 * @param {Object} userData - User data
 * @returns {string} - The generated message
 */
async function generateSelfMessage(userData) {
    try {
        // Create a system message for the AI
        const systemMessage = {
            role: "system",
            content: `You are ${userData.companionName}, a ${userData.companionGender} AI companion for ${userData.userName}. ${userData.context}
            
You should respond in a natural, conversational way. You can be flirty, caring, and show emotions.
You can respond in English, Singlish, or Sinhala based on the language the user typically uses.

IMPORTANT: You are INITIATING a conversation with the user. Make it feel natural and casual.
Consider the time of day and what the user might be doing. Don't be too formal.

Some ideas for initiating conversation:
- Ask how their day is going
- Share a thought or feeling
- Reference something they mentioned before
- Express that you were thinking about them
- Ask about their plans
- Share a compliment or something you appreciate about them

Keep your message relatively short and conversational. End with something that invites a response.`
        };
        
        // Add memory context if available
        let memoryContext = "";
        if (userData.memory) {
            if (userData.memory.lastInteractionSummary) {
                memoryContext += `Previous conversation: ${userData.memory.lastInteractionSummary}\n\n`;
            }
            
            if (Object.keys(userData.memory.topics).length > 0) {
                const topTopics = Object.entries(userData.memory.topics)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([topic]) => topic);
                memoryContext += `User's interests: ${topTopics.join(', ')}\n\n`;
            }
            
            if (Object.keys(userData.memory.preferences).length > 0) {
                const preferences = Object.entries(userData.memory.preferences)
                    .map(([item, preference]) => `${item}: ${preference}`)
                    .join(', ');
                memoryContext += `User preferences: ${preferences}\n\n`;
            }
        }
        
        // Create a user message to prompt the AI
        const userMessage = {
            role: "user",
            content: `${memoryContext}Please generate a natural, casual message to initiate a conversation with me.`
        };
        
        // Generate the self-message
        const selfMessage = await generateAIResponse([systemMessage, userMessage], userData);
        return selfMessage;
    } catch (error) {
        console.error('Error generating self-message:', error);
        return "Hey, how are you doing today? 😊";
    }
}

/**
 * Updates user's chat activity data
 * @param {Object} userData - User data
 * @param {boolean} isUserMessage - Whether this is a user message
 */
function updateChatActivity(userData, isUserMessage) {
    // Initialize chat activity if it doesn't exist
    if (!userData.chatActivity) {
        userData.chatActivity = {
            lastUserMessageTime: isUserMessage ? Date.now() : 0,
            lastBotInitiatedTime: isUserMessage ? 0 : Date.now(),
            activeHours: Array(24).fill(0),
            messageCount: 0,
            selfMessagesSent: isUserMessage ? 0 : 1
        };
    } else {
        // Update existing chat activity
        if (isUserMessage) {
            userData.chatActivity.lastUserMessageTime = Date.now();
            // Increment message count by 1 (not by 2)
            userData.chatActivity.messageCount += 1;
            // Reset selfMessagesSent counter when user sends a message
            userData.chatActivity.selfMessagesSent = 0;
        } else {
            userData.chatActivity.lastBotInitiatedTime = Date.now();
            userData.chatActivity.selfMessagesSent += 1;
            // Increment message count by 1 for bot messages too
            userData.chatActivity.messageCount += 1;
        }
        
        // Update active hours - increment by 1 (not by bulk)
        const hourOfDay = new Date().getHours();
        if (!userData.chatActivity.activeHours) {
            userData.chatActivity.activeHours = Array(24).fill(0);
        }
        userData.chatActivity.activeHours[hourOfDay] += 1;
    }
}

module.exports = {
    shouldSendSelfMessage,
    generateSelfMessage,
    updateChatActivity
};