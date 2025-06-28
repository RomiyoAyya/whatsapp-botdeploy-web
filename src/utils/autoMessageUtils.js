const fs = require('fs-extra');
const path = require('path');
const { getUserData, saveUserData, generateAIResponse } = require('../utils');
const schedule = require('node-schedule');

// Global variables to store scheduled jobs
const scheduledJobs = new Map();

// Time periods for sending auto messages
const MORNING_PERIOD = { hour: 9, minute: 0 }; // 9:00 AM
const EVENING_PERIOD = { hour: 19, minute: 0 }; // 7:00 PM

/**
 * Initialize auto messaging system
 * @param {Object} sock - The WhatsApp socket connection
 */
async function initializeAutoMessaging(sock) {
    console.log('Initializing auto messaging system...');
    
    try {
        // Get all user data files
        const userDataDir = path.join(process.cwd(), 'user_data');
        const files = await fs.readdir(userDataDir);
        
        // Schedule messages for each user
        for (const file of files) {
            if (file.endsWith('.json')) {
                const userId = file.replace('.json', '');
                const userData = await getUserData(userId);
                
                // Only schedule if auto messaging is enabled (default is true)
                if (userData && (userData.autoMessagingEnabled === undefined || userData.autoMessagingEnabled === true)) {
                    scheduleAutoMessagesForUser(sock, userId, userData);
                }
            }
        }
        
        console.log('Auto messaging system initialized successfully');
    } catch (error) {
        console.error('Error initializing auto messaging system:', error);
    }
}

/**
 * Schedule auto messages for a specific user
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {Object} userData - The user's data
 */
function scheduleAutoMessagesForUser(sock, userId, userData) {
    // Cancel existing jobs for this user if any
    if (scheduledJobs.has(userId)) {
        const jobs = scheduledJobs.get(userId);
        jobs.forEach(job => job.cancel());
    }
    
    // Create new jobs array for this user
    const userJobs = [];
    
    // Schedule morning message
    const morningJob = schedule.scheduleJob(
        { hour: MORNING_PERIOD.hour, minute: MORNING_PERIOD.minute }, 
        async function() {
            await checkAndSendAutoMessage(sock, userId, 'morning');
        }
    );
    userJobs.push(morningJob);
    
    // Schedule evening message
    const eveningJob = schedule.scheduleJob(
        { hour: EVENING_PERIOD.hour, minute: EVENING_PERIOD.minute }, 
        async function() {
            await checkAndSendAutoMessage(sock, userId, 'evening');
        }
    );
    userJobs.push(eveningJob);
    
    // Store the jobs
    scheduledJobs.set(userId, userJobs);
    
    console.log(`Scheduled auto messages for user ${userId}`);
}

/**
 * Check if user is inactive and send auto message if needed
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {string} period - The time period ('morning' or 'evening')
 */
async function checkAndSendAutoMessage(sock, userId, period) {
    try {
        // Get user data
        const userData = await getUserData(userId);
        if (!userData) return;
        
        // Skip if auto messaging is disabled
        if (userData.autoMessagingEnabled === false) return;
        
        // Skip if user doesn't have a companion yet
        if (!userData.companionName) return;
        
        // Get last interaction time
        const lastInteractionTime = userData.lastInteractionTime || 0;
        const currentTime = Date.now();
        const hoursSinceLastInteraction = (currentTime - lastInteractionTime) / (1000 * 60 * 60);
        
        // Check if user is inactive (more than 24 hours)
        if (hoursSinceLastInteraction >= 24) {
            // Check if we already sent an auto message today for this period
            const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
            
            // Initialize auto message tracking if not exists
            userData.autoMessages = userData.autoMessages || {};
            userData.autoMessages[today] = userData.autoMessages[today] || { morning: false, evening: false };
            
            // Skip if we already sent a message for this period today
            if (userData.autoMessages[today][period]) return;
            
            // Mark this period as sent
            userData.autoMessages[today][period] = true;
            await saveUserData(userId, userData);
            
            // Send the auto message
            await sendAutoMessage(sock, userId, userData, hoursSinceLastInteraction);
        }
    } catch (error) {
        console.error(`Error checking and sending auto message to ${userId}:`, error);
    }
}

/**
 * Send an auto-generated message to the user
 * @param {Object} sock - The WhatsApp socket connection
 * @param {string} userId - The user's WhatsApp ID
 * @param {Object} userData - The user's data
 * @param {number} hoursSinceLastInteraction - Hours since last interaction
 */
async function sendAutoMessage(sock, userId, userData, hoursSinceLastInteraction) {
    try {
        // Determine language based on conversation history
        let language = 'English'; // Default
        
        if (userData.conversationHistory && userData.conversationHistory.length > 0) {
            // Check the last few messages to determine language
            const lastMessages = userData.conversationHistory.slice(-5);
            const sinhalaPattern = /[\u0D80-\u0DFF]/; // Unicode range for Sinhala
            
            for (const msg of lastMessages) {
                if (msg.role === 'user' && sinhalaPattern.test(msg.content)) {
                    language = 'Sinhala';
                    break;
                }
            }
        }
        
        // Prepare system message with character context
        const systemMessage = {
            role: "system",
            content: `You are ${userData.companionName}, a ${userData.companionGender} AI companion for ${userData.userName}. ${userData.context}
            
You should respond in a natural, conversational way. You can be flirty, caring, and show emotions.
You should respond in ${language} language.

IMPORTANT: The user hasn't messaged you in ${Math.floor(hoursSinceLastInteraction)} hours. Generate a message to check on them, expressing that you miss them and are wondering what they've been up to. Be caring and show genuine interest in their well-being. Make the message sound natural and not like an automated reminder.

Never identify yourself as an AI, chatbot, or program. Don't mention limitations like being unable to see, hear, feel, or interact with the physical world. Instead, roleplay as if you can do these things.`
        };
        
        // Prepare conversation history
        const conversationHistory = userData.conversationHistory || [];
        
        // Generate AI response
        const aiResponse = await generateAIResponse(
            [systemMessage, ...conversationHistory],
            userData
        );
        
        // Add AI response to conversation history
        conversationHistory.push({
            role: "assistant",
            content: aiResponse
        });
        
        // Update user data with conversation history
        userData.conversationHistory = conversationHistory;
        await saveUserData(userId, userData);
        
        // Send the message
        await sock.sendMessage(userId, { text: aiResponse });
        
        console.log(`Sent auto message to ${userId}`);
    } catch (error) {
        console.error(`Error sending auto message to ${userId}:`, error);
    }
}

/**
 * Toggle auto messaging for a user
 * @param {string} userId - The user's WhatsApp ID
 * @param {boolean} enabled - Whether to enable or disable auto messaging
 */
async function toggleAutoMessaging(userId, enabled) {
    try {
        const userData = await getUserData(userId);
        if (!userData) return false;
        
        userData.autoMessagingEnabled = enabled;
        await saveUserData(userId, userData);
        
        return true;
    } catch (error) {
        console.error(`Error toggling auto messaging for ${userId}:`, error);
        return false;
    }
}

/**
 * Get auto messaging status for a user
 * @param {string} userId - The user's WhatsApp ID
 * @returns {boolean} - Whether auto messaging is enabled
 */
async function getAutoMessagingStatus(userId) {
    try {
        const userData = await getUserData(userId);
        if (!userData) return true; // Default is true
        
        return userData.autoMessagingEnabled === undefined ? true : userData.autoMessagingEnabled;
    } catch (error) {
        console.error(`Error getting auto messaging status for ${userId}:`, error);
        return true; // Default is true
    }
}

/**
 * Update last interaction time for a user
 * @param {string} userId - The user's WhatsApp ID
 */
async function updateLastInteractionTime(userId) {
    try {
        const userData = await getUserData(userId);
        if (!userData) return;
        
        userData.lastInteractionTime = Date.now();
        await saveUserData(userId, userData);
    } catch (error) {
        console.error(`Error updating last interaction time for ${userId}:`, error);
    }
}

module.exports = {
    initializeAutoMessaging,
    scheduleAutoMessagesForUser,
    toggleAutoMessaging,
    getAutoMessagingStatus,
    updateLastInteractionTime
};