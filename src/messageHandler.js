const path = require('path');
const fs = require('fs-extra');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { saveUserData, getUserData, isPremiumUser } = require('./utils');
const commandHandlers = require('./handlers/commandHandlers');
const { handleAIConversation } = require('./handlers/conversationHandler');
const { processUserState } = require('./handlers/userStateHandler');
const { handleCollaborativeImage } = require('./handlers/imageHandler');
const autoMessageUtils = require('./utils/autoMessageUtils');
const licenseUtils = require('./utils/licenseUtils');
const reminderUtils = require('./utils/reminderUtils'); // Add this line

// User session states - exported so other modules can access it
// Create a Map to store user states
const userStates = new Map();

// Handle incoming messages
// Update the handleMessages function to accept userStates
async function handleMessages(sock, message, userStates) {
    try {
        // Skip if message is from status broadcast
        if (message.key.remoteJid === 'status@broadcast') return;
        
        // Skip if message is from the bot itself
        if (message.key.fromMe) return;
        
        // Get the user ID
        const userId = message.key.remoteJid;
        const botOwner = process.env.BOT_OWNER;
        
        // Get message text
        const messageText = message.message.conversation || 
                           (message.message.extendedTextMessage && 
                            message.message.extendedTextMessage.text) || '';
        
        // Check if the bot is registered
        const botNumber = process.env.BOT_NUMBER || sock.user.id.split(':')[0];
        const status = await licenseUtils.checkBotStatus(botNumber);
        const isRegistered = status.success && status.registered;
        
        // Always allow the /register command and messages from the bot owner
        if (messageText.startsWith('/register')) {
            // Update last interaction time whenever user sends a message
            await autoMessageUtils.updateLastInteractionTime(userId);
            
            // Handle the register command
            const [command, ...args] = messageText.trim().split(' ');
            
            if (commandHandlers[command]) {
                await commandHandlers[command](sock, message, args, userStates);
                return;
            }
        } else if (userId === botOwner && isRegistered) {
            // Process messages from the bot owner normally if license is valid
            // Update last interaction time
            await autoMessageUtils.updateLastInteractionTime(userId);
        } else if (!isRegistered) {
            // Bot is not registered, notify the user
            await sock.sendMessage(userId, {
                text: `⚠️ *Bot Not Registered* ⚠️\n\nThis bot is currently not registered. Please contact the bot owner at wa.me/${process.env.BOT_OWNER.replace('@s.whatsapp.net', '')} to request registration.`
            });
            return; // Prevent further processing
        }
        
        // If we get here, either the bot is registered or this is a /register command
        
        // If bot is not registered, block all other commands and messages
        if (!isRegistered && !messageText.startsWith('/register')) {
            await sock.sendMessage(userId, {
                text: `⚠️ *Bot Not Registered* ⚠️\n\nThis bot is currently not registered. Please contact the bot owner at wa.me/${process.env.BOT_OWNER.replace('@s.whatsapp.net', '')} to request registration.`
            });
            return; // Prevent further processing
        }
        
        // Continue with the rest of the message handling for registered bots
        if (messageText.startsWith('/')) {
            const [command, ...args] = messageText.trim().split(' ');
            
            // Pass userStates to the command handler
            if (commandHandlers[command]) {
                await commandHandlers[command](sock, message, args, userStates);
                return;
            }
        }
        
        // Check for natural language reminder requests
        const reminderPatterns = [
            /remind me (to|about) (.*?) (at|on|in) (.*)/i,
            /set a reminder (to|about|for) (.*?) (at|on|in) (.*)/i,
            /set a reminder (at|on|in) (.*?) (to|about|for) (.*)/i,
            /remind me (at|on|in) (.*?) (to|about) (.*)/i,
            // Add new patterns to match more natural language formats
            /remind me to (.*?) (at|on|in) (.*)/i,
            /remind me (at|on|in) (.*?) to (.*)/i,
            /remind me to (.*)/i
        ];
        
        for (const pattern of reminderPatterns) {
            const match = messageText.match(pattern);
            if (match) {
                // Get user data to check if they have a companion
                const userData = await getUserData(userId);
                if (!userData || !userData.companionName) {
                    // Skip reminder processing if user doesn't have a companion
                    break;
                }
                
                // Extract reminder text and time based on pattern
                let reminderText, timeString;
                
                if (pattern.source.startsWith('remind me (to|about)') || 
                    pattern.source.startsWith('set a reminder (to|about|for)')) {
                    reminderText = match[2];
                    timeString = match[4];
                } else if (pattern.source.startsWith('remind me to (.*?) (at|on|in)')) {
                    reminderText = match[1];
                    timeString = match[3];
                } else if (pattern.source.startsWith('remind me (at|on|in) (.*?) to')) {
                    timeString = match[2];
                    reminderText = match[3];
                } else if (pattern.source.startsWith('remind me to (.*)')) {
                    reminderText = match[1];
                    // Default to 'in 1 hour' if no time specified
                    timeString = 'in 1 hour';
                } else {
                    timeString = match[2];
                    reminderText = match[4];
                }
                
                // Check for recurring pattern
                let recurring = null;
                const recurringPatterns = [
                    { pattern: /\s+daily$/i, type: 'daily' },
                    { pattern: /\s+every\s+day$/i, type: 'daily' },
                    { pattern: /\s+weekly$/i, type: 'weekly' },
                    { pattern: /\s+every\s+week$/i, type: 'weekly' },
                    { pattern: /\s+monthly$/i, type: 'monthly' },
                    { pattern: /\s+every\s+month$/i, type: 'monthly' }
                ];
                
                for (const { pattern, type } of recurringPatterns) {
                    if (pattern.test(reminderText)) {
                        recurring = type;
                        reminderText = reminderText.replace(pattern, '').trim();
                        break;
                    }
                }
                
                // Parse the time
                const time = reminderUtils.parseTimeString(timeString);
                
                if (time) {
                    // Create the reminder
                    const reminderId = await reminderUtils.createReminder(
                        sock,
                        userId,
                        reminderText,
                        time,
                        recurring
                    );
                    
                    if (reminderId) {
                        // Format the time
                        const timeOptions = { 
                            weekday: 'long', 
                            year: 'numeric', 
                            month: 'long', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        };
                        const formattedTime = time.toLocaleString('en-US', timeOptions);
                        
                        // Format the response
                        let response = `✅ I've set a reminder for you!\n\n`;
                        response += `I'll remind you to *${reminderText}*\n`;
                        response += `📅 ${formattedTime}`;
                        
                        if (recurring) {
                            response += `\n🔄 Recurring: ${recurring}`;
                        }
                        
                        await sock.sendMessage(userId, { text: response });
                        return;
                    }
                }
                
                // If we get here, time parsing failed
                await sock.sendMessage(userId, { 
                    text: "I understood you want to set a reminder, but I couldn't understand the time. Try using the /remind command instead, like:\n\n/remind today at 12:02pm to eat lunch" 
                });
                return;
            }
        }
        
        // Process user state (creation flow, reset confirmation, etc.)
        const stateProcessed = await processUserState(sock, message, userStates);
        if (stateProcessed) return;
        
        // Handle collaborative image generation
        if (message.message.imageMessage && 
            message.message.imageMessage.caption && 
            message.message.imageMessage.caption.startsWith('/collob')) {
            await handleCollaborativeImage(sock, message);
            return;
        }
        
        // Handle AI conversation
        await handleAIConversation(sock, message);
        
    } catch (error) {
        console.error('Error handling message:', error);
    }
}

module.exports = { handleMessages };