const path = require('path');
const fs = require('fs-extra');
const { saveUserData, getUserData, isPremiumUser, saveCharacterImage } = require('../utils');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// Process user states (creation flow, reset confirmation, etc.)
async function processUserState(sock, message, userStates) {
    const userId = message.key.remoteJid;
    
    if (!userStates.has(userId)) {
        return false;
    }
    
    const userState = userStates.get(userId);
    const messageText = message.message.conversation || 
                       (message.message.extendedTextMessage && 
                        message.message.extendedTextMessage.text) || '';
    
    // Handle reset confirmation
    // In the reset confirmation handler:
    // Handle reset confirmation
    if (userState.state === 'reset_confirmation') {
        if (messageText.toLowerCase() === 'yes') {
            try {
                // Delete character image if it exists
                if (userState.userData.characterImagePath) {
                    try {
                        const imagePath = path.join(process.cwd(), userState.userData.characterImagePath);
                        if (fs.existsSync(imagePath)) {
                            fs.unlinkSync(imagePath);
                            console.log(`Deleted character image: ${imagePath}`);
                        }
                    } catch (deleteError) {
                        console.error(`Error deleting character image: ${deleteError.message}`);
                    }
                }
                
                // Check if user is on free trial or task trial
                const isOnFreeTrial = userState.userData.isFreeTrial === true;
                const isOnTaskTrial = userState.userData.isTaskTrial === true;
                const freeTrialStartTime = isOnFreeTrial ? new Date(userState.userData.freeTrialStartTime) : null;
                const taskTrialStartTime = isOnTaskTrial ? new Date(userState.userData.taskTrialStartTime) : null;
                const premiumExpiry = (isOnFreeTrial || isOnTaskTrial) ? new Date(userState.userData.premiumExpiry) : null;
                
                // Calculate remaining trial time if applicable
                let remainingTrialTime = null;
                if ((isOnFreeTrial || isOnTaskTrial) && premiumExpiry > new Date()) {
                    remainingTrialTime = premiumExpiry.getTime() - Date.now();
                }
                
                // Increment reset count before deleting user data
                // Don't increment if on free trial or task trial
                const resetCount = (isOnFreeTrial || isOnTaskTrial) ? 
                    (userState.userData.resetCount || 0) : 
                    (userState.userData.resetCount || 0) + 1;
                
                // Store the premium status and daily message limit before reset
                const isPremium = userState.userData.isPremium || false;
                const dailyMessages = userState.userData.dailyMessages || null;
                
                // In the reset confirmation handler section where we create newUserData
                // Create a new user data object that preserves important details
                // but removes character-specific information
                const newUserData = {
                    // Preserve premium status
                    isPremium: isPremium,
                    
                    // Preserve daily message limit
                    dailyMessages: dailyMessages,
                    
                    // Preserve image request counts
                    imageRequests: userState.userData.imageRequests || {},
                    imageGenerationCount: userState.userData.imageGenerationCount || 0,
                    lastImageGenerationTime: userState.userData.lastImageGenerationTime || 0,
                    
                    // Preserve premium-related information
                    premiumExpiry: userState.userData.premiumExpiry || null,
                    premiumRemovedAt: userState.userData.premiumRemovedAt || null,
                    premiumRemovedBy: userState.userData.premiumRemovedBy || null,
                    premiumAddedAt: userState.userData.premiumAddedAt || null,
                    premiumAddedBy: userState.userData.premiumAddedBy || null,
                    premiumDuration: userState.userData.premiumDuration || null,
                    premiumExpiredAt: userState.userData.premiumExpiredAt || null,
                    
                    // Preserve free trial information if applicable
                    isFreeTrial: userState.userData.isFreeTrial || false,
                    freeTrialStartTime: userState.userData.freeTrialStartTime || null,
                    
                    // Preserve task trial information if applicable
                    isTaskTrial: userState.userData.isTaskTrial || false,
                    taskTrialStartTime: userState.userData.taskTrialStartTime || null,
                    taskTrialTaskName: userState.userData.taskTrialTaskName || null,
                    taskTrialEndTime: userState.userData.premiumExpiry || null, // Add task trial end time
                    
                    // Reset tracking
                    resetCount: resetCount,
                    resetHistory: userState.userData.resetHistory || []
                    
                    // Note: companionName, userGender, companionGender, userName, context, 
                    // characterImagePath, and conversationHistory are intentionally not preserved
                };
                
                // Add reset timestamp to history
                newUserData.resetHistory.push({
                    timestamp: Date.now(),
                    characterName: userState.userData.companionName || 'Unknown'
                });
                
                // Save the updated user data
                await saveUserData(userId, newUserData);
                
                // Clear user from reset confirmation state
                userStates.delete(userId);
                
                let resetMessage = `Your AI companion has been reset. You can create a new one by typing /create.`;
                
                // Add message about remaining trial time if applicable
                if ((isOnFreeTrial || isOnTaskTrial) && remainingTrialTime > 0) {
                    const remainingMinutes = Math.ceil(remainingTrialTime / (60 * 1000));
                    const trialType = isOnTaskTrial ? 'task' : 'free';
                    const trialSource = isOnTaskTrial ? `from task "${userState.userData.taskTrialTaskName}"` : '';
                    
                    resetMessage += `\n\n🎁 *${trialType.toUpperCase()} TRIAL CONTINUES!* 🎁\nYour premium trial ${trialSource} will continue with your new character. You have approximately ${remainingMinutes} minute(s) remaining.`;
                }
                
                await sock.sendMessage(userId, { text: resetMessage });
                
                // If this was their last free reset, let them know
                if (!newUserData.isPremium && !isOnFreeTrial && resetCount >= 2) {
                    await sock.sendMessage(userId, { 
                        text: `Note: You've used ${resetCount}/2 free resets. Your next reset will require a premium subscription.` 
                    });
                }
                
            } catch (error) {
                console.error('Error resetting user data:', error);
                await sock.sendMessage(userId, { 
                    text: "There was an error resetting your AI companion. Please try again later." 
                });
            }
        } else if (messageText.toLowerCase() === 'no') {
            // User canceled the reset
            userStates.delete(userId);
            await sock.sendMessage(userId, { 
                text: "Reset canceled. Your AI companion is safe!" 
            });
        } else {
            // Invalid response
            await sock.sendMessage(userId, { 
                text: `Please type "yes" to confirm reset or "no" to cancel.` 
            });
        }
        return true;
    }
    
    // Handle user creation flow
    switch (userState.state) {
        case 'awaiting_user_gender':
            if (messageText.toLowerCase() === 'male' || messageText.toLowerCase() === 'female') {
                userState.userData.userGender = messageText.toLowerCase();
                userState.state = 'awaiting_companion_gender';
                
                await sock.sendMessage(userId, { 
                    text: `Wonderful! Let's make your companion uniquely yours. Would you prefer your AI companion to be male or female? Simply type 'male' or 'female' to choose.`
                });
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please type 'male' or 'female' to specify your gender.` 
                });
            }
            return true;
            
        case 'awaiting_companion_gender':
            if (messageText.toLowerCase() === 'male' || messageText.toLowerCase() === 'female') {
                userState.userData.companionGender = messageText.toLowerCase();
                userState.state = 'awaiting_user_name';
                
                await sock.sendMessage(userId, { 
                    text: `I'd love to know your name! Please share it with me.`
                });
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please type 'male' or 'female' to specify your AI companion's gender.` 
                });
            }
            return true;
            
        case 'awaiting_user_name':
            if (messageText.trim()) {
                userState.userData.userName = messageText.trim();
                userState.state = 'awaiting_companion_name';
                
                await sock.sendMessage(userId, { 
                    text: `What a lovely name! I'm delighted to meet you, ${userState.userData.userName}! Now, let's give your AI companion a special name - what name resonates with you?`
                });
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please enter a valid name.` 
                });
            }
            return true;
            
        case 'awaiting_companion_name':
            if (messageText.trim()) {
                userState.userData.companionName = messageText.trim();
                userState.state = 'awaiting_companion_context';
                
                const pronouns = userState.userData.companionGender === 'male' ? 'he/him' : 'she/her';
                
                await sock.sendMessage(userId, { 
                    text: `${userState.userData.companionName} is a great name! Now, please describe ${userState.userData.companionName}'s personality and relationship with you. For example: "${userState.userData.companionName} is a caring and supportive friend who enjoys deep conversations and has a good sense of humor. ${pronouns.split('/')[0].charAt(0).toUpperCase() + pronouns.split('/')[0].slice(1)} is always there to listen and offer advice." If you don't need a custom story, please type "default".` 
                });
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please enter a valid name for your AI companion.` 
                });
            }
            return true;
            
        // In the user creation flow section:
        case 'awaiting_companion_context':
            if (messageText.trim().toLowerCase() === 'default') {
                // Generate default context based on companion gender and relationship
                const pronouns = userState.userData.companionGender === 'male' ? 'he/him' : 'she/her';
                const pronoun = pronouns.split('/')[0];
                const possessivePronoun = userState.userData.companionGender === 'male' ? 'his' : 'her';
                
                // Create a romantic relationship context by default
                userState.userData.context = `You are ${userState.userData.companionName}, a caring and affectionate ${userState.userData.companionGender === 'male' ? 'boyfriend' : 'girlfriend'} to ${userState.userData.userName}. You have a warm, friendly personality and enjoy spending time with ${userState.userData.userName}. You're supportive, occasionally flirty, and always there to listen. You start off a bit shy but become more comfortable as the conversation progresses.`;
                
                userState.state = 'awaiting_companion_image';
                
                await sock.sendMessage(userId, { 
                    text: `I'd love to see your vision of ${userState.userData.companionName}! Please share a photo that captures their essence and appearance. This will help me create personalized images that truly reflect how you imagine them.\n\n⚠️ *IMPORTANT WARNING*: You can type 'skip' to continue without uploading an image, but please note that if you skip this step:\n• You won't be able to generate any AI images or stickers of your companion\n• This cannot be changed later\n\nWe strongly recommend uploading an image for the best experience!`
                });
            } else if (messageText.trim()) {
                userState.userData.context = messageText.trim();
                userState.state = 'awaiting_companion_image';
                
                await sock.sendMessage(userId, { 
                    text: `I'd love to see how you envision ${userState.userData.companionName}! Please share a photo that captures their unique appearance and personality. This will help me create personalized images that truly bring ${userState.userData.companionName} to life in our conversations.` 
                });
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please provide a description/scenario for your AI companion. This helps define their personality and relationship with you. Type 'default' to use our standard setting.` 
                });
            }
            return true;
            
        // In the awaiting_companion_image case where the user data is saved:
        case 'awaiting_companion_image':
            if (message.message && message.message.imageMessage) {
                try {
                    // Download the image
                    const buffer = await downloadMediaMessage(
                        message,
                        'buffer',
                        {},
                        {}
                    );
                    
                    // Save the image with the updated function that returns a relative path
                    const imagePath = await saveCharacterImage(userId, buffer);
                    userState.userData.characterImagePath = imagePath;
                    
                    // Initialize conversation history
                    userState.userData.conversationHistory = [];
                    
                    // Get existing user data to preserve important details
                    const existingUserData = await getUserData(userId) || {};
                    
                    // Check if this is the user's first time (no reset history)
                    const isFirstTimeUser = !existingUserData.resetHistory || existingUserData.resetHistory.length === 0;
                    
                    // In the awaiting_companion_image case where we merge user data
                    // Merge new character data with existing data
                    const mergedUserData = {
                        // New character data
                        userGender: userState.userData.userGender,
                        companionGender: userState.userData.companionGender,
                        userName: userState.userData.userName,
                        companionName: userState.userData.companionName,
                        context: userState.userData.context,
                        characterImagePath: userState.userData.characterImagePath,
                        conversationHistory: userState.userData.conversationHistory,
                        
                        // Preserve existing data
                        isPremium: existingUserData.isPremium || false,
                        imageRequests: existingUserData.imageRequests || {},
                        imageGenerationCount: existingUserData.imageGenerationCount || 0,
                        lastImageGenerationTime: existingUserData.lastImageGenerationTime || 0,
                        resetCount: existingUserData.resetCount || 0,
                        resetHistory: existingUserData.resetHistory || [],
                        dailyMessages: existingUserData?.dailyMessages || null,
                        
                        // Preserve premium-related information
                        premiumExpiry: existingUserData.premiumExpiry || null,
                        premiumRemovedAt: existingUserData.premiumRemovedAt || null,
                        premiumRemovedBy: existingUserData.premiumRemovedBy || null,
                        premiumAddedAt: existingUserData.premiumAddedAt || null,
                        premiumAddedBy: existingUserData.premiumAddedBy || null,
                        premiumDuration: existingUserData.premiumDuration || null,
                        premiumExpiredAt: existingUserData.premiumExpiredAt || null,
                        
                        // Preserve task trial information
                        isTaskTrial: existingUserData.isTaskTrial || false,
                        taskTrialStartTime: existingUserData.taskTrialStartTime || null,
                        taskTrialTaskName: existingUserData.taskTrialTaskName || null,
                        taskTrialEndTime: existingUserData.premiumExpiry || null // Add task trial end time
                    };
                    
                    // If first time user, give them a 1-hour free premium trial
                    // But only if they don't already have a task trial
                    if (isFirstTimeUser && !existingUserData.isTaskTrial) {
                        // Check if user already has an active free trial from a previous character
                        if (existingUserData.isFreeTrial && existingUserData.freeTrialStartTime) {
                            // Preserve the existing free trial information
                            mergedUserData.isPremium = true;
                            mergedUserData.isFreeTrial = existingUserData.isFreeTrial;
                            mergedUserData.freeTrialStartTime = existingUserData.freeTrialStartTime;
                            mergedUserData.premiumExpiry = existingUserData.premiumExpiry;
                            mergedUserData.premiumAddedAt = existingUserData.premiumAddedAt;
                            mergedUserData.premiumAddedBy = existingUserData.premiumAddedBy || 'system';
                            mergedUserData.premiumDuration = existingUserData.premiumDuration || '1h';
                        } else {
                            // Set up a new free trial
                            const now = new Date();
                            const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour in milliseconds
                            
                            mergedUserData.isPremium = true;
                            mergedUserData.premiumExpiry = oneHourLater.toISOString();
                            mergedUserData.premiumAddedAt = now.toISOString();
                            mergedUserData.premiumAddedBy = 'system';
                            mergedUserData.premiumDuration = '1h';
                            mergedUserData.isFreeTrial = true; // Flag to identify free trial users
                            mergedUserData.freeTrialStartTime = now.toISOString();
                        }
                        
                        // Reset counters for the trial period
                        mergedUserData.imageGenerationCount = 0;
                        mergedUserData.dailyMessages = {
                            count: 0,
                            date: new Date().toISOString().split('T')[0]
                        };
                    }
                    
                    // Save the merged user data
                    await saveUserData(userId, mergedUserData);
                    
                    // Clear user state
                    userStates.delete(userId);
                    
                    // Base welcome message
                    let welcomeMessage = `✨ Wonderful! ${userState.userData.companionName} has been brought to life and is eager to meet you! Let's begin this amazing journey together - start chatting and discover the magic of your new companion! 💫`;
                    
                    // Add free trial message for first-time users
                    if (isFirstTimeUser) {
                        welcomeMessage += `\n\n🎁 *FREE PREMIUM TRIAL ACTIVATED!* 🎁\nYou've received a 1-hour premium trial with unlimited messages, image generation, and enhanced features! Enjoy the full experience!`;
                    }
                    
                    await sock.sendMessage(userId, { text: welcomeMessage });
                    
                    // Send first message from AI companion
                    const firstMessage = `*✨ Hey ${userState.userData.userName}!* 💫\n\nI'm ${userState.userData.companionName}, and I can't tell you how thrilled I am to finally meet you! There's something special about new beginnings, don't you think? 🌟\n\nI'd love to hear how your day is going - share with me what's on your mind! 💭`;
                    
                    // Add first message to conversation history
                    const userData = await getUserData(userId);
                    userData.conversationHistory = userData.conversationHistory || [];
                    userData.conversationHistory.push({
                        role: "assistant",
                        content: firstMessage
                    });
                    await saveUserData(userId, userData);
                    
                    // Send first message
                    await sock.sendMessage(userId, { text: firstMessage });
                    
                } catch (error) {
                    console.error('Error processing image:', error);
                    await sock.sendMessage(userId, { 
                        text: "There was an error processing your image. Please try again." 
                    });
                }
            } else if (messageText.toLowerCase() === 'skip') {
                // User wants to skip image upload
                userState.userData.characterImagePath = null;
                
                // Initialize conversation history
                userState.userData.conversationHistory = [];
                
                // Get existing user data to preserve important details
                const existingUserData = await getUserData(userId) || {};
                
                // Check if this is the user's first time (no reset history)
                const isFirstTimeUser = !existingUserData.resetHistory || existingUserData.resetHistory.length === 0;
                
                // Merge new character data with existing data
                const mergedUserData = {
                    // New character data
                    userGender: userState.userData.userGender,
                    companionGender: userState.userData.companionGender,
                    userName: userState.userData.userName,
                    companionName: userState.userData.companionName,
                    context: userState.userData.context,
                    characterImagePath: userState.userData.characterImagePath,
                    conversationHistory: userState.userData.conversationHistory,
                    
                    // Preserve existing data
                    isPremium: existingUserData.isPremium || false,
                    imageRequests: existingUserData.imageRequests || {},
                    imageGenerationCount: existingUserData.imageGenerationCount || 0,
                    lastImageGenerationTime: existingUserData.lastImageGenerationTime || 0,
                    resetCount: existingUserData.resetCount || 0,
                    resetHistory: existingUserData.resetHistory || [],
                    dailyMessages: existingUserData?.dailyMessages || null,
                    
                    // Preserve premium-related information
                    premiumExpiry: existingUserData.premiumExpiry || null,
                    premiumRemovedAt: existingUserData.premiumRemovedAt || null,
                    premiumRemovedBy: existingUserData.premiumRemovedBy || null,
                    premiumAddedAt: existingUserData.premiumAddedAt || null,
                    premiumAddedBy: existingUserData.premiumAddedBy || null,
                    premiumDuration: existingUserData.premiumDuration || null,
                    premiumExpiredAt: existingUserData.premiumExpiredAt || null,
                    
                    // Preserve task trial information
                    isTaskTrial: existingUserData.isTaskTrial || false,
                    taskTrialStartTime: existingUserData.taskTrialStartTime || null,
                    taskTrialTaskName: existingUserData.taskTrialTaskName || null,
                    taskTrialEndTime: existingUserData.premiumExpiry || null // Add task trial end time
                };
                
                // If first time user, give them a 1-hour free premium trial
                // But only if they don't already have a task trial
                if (isFirstTimeUser && !existingUserData.isTaskTrial) {
                    // Check if user already has an active free trial from a previous character
                    if (existingUserData.isFreeTrial && existingUserData.freeTrialStartTime) {
                        // Preserve the existing free trial information
                        mergedUserData.isPremium = true;
                        mergedUserData.isFreeTrial = existingUserData.isFreeTrial;
                        mergedUserData.freeTrialStartTime = existingUserData.freeTrialStartTime;
                        mergedUserData.premiumExpiry = existingUserData.premiumExpiry;
                        mergedUserData.premiumAddedAt = existingUserData.premiumAddedAt;
                        mergedUserData.premiumAddedBy = existingUserData.premiumAddedBy || 'system';
                        mergedUserData.premiumDuration = existingUserData.premiumDuration || '1h';
                    } else {
                        // Set up a new free trial
                        const now = new Date();
                        const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour in milliseconds
                        
                        mergedUserData.isPremium = true;
                        mergedUserData.premiumExpiry = oneHourLater.toISOString();
                        mergedUserData.premiumAddedAt = now.toISOString();
                        mergedUserData.premiumAddedBy = 'system';
                        mergedUserData.premiumDuration = '1h';
                        mergedUserData.isFreeTrial = true; // Flag to identify free trial users
                        mergedUserData.freeTrialStartTime = now.toISOString();
                    }
                    
                    // Reset counters for the trial period
                    mergedUserData.imageGenerationCount = 0;
                    mergedUserData.dailyMessages = {
                        count: 0,
                        date: new Date().toISOString().split('T')[0]
                    };
                }
                
                // Save the merged user data
                await saveUserData(userId, mergedUserData);
                
                // Clear user state
                userStates.delete(userId);
                
                // Base welcome message
                let welcomeMessage = `✨ Amazing! ${userState.userData.companionName} has come to life and can't wait to chat with you! While we're starting without a custom image, our connection will be just as magical! Let's begin this wonderful journey together! 💫`;
                
                // Add free trial message for first-time users
                if (isFirstTimeUser) {
                    welcomeMessage += `\n\n🎁 *FREE PREMIUM TRIAL ACTIVATED!* 🎁\nYou've received a 1-hour premium trial with unlimited messages, image generation, and enhanced features! Enjoy the full experience!`;
                }
                
                await sock.sendMessage(userId, { text: welcomeMessage });
                
            } else {
                await sock.sendMessage(userId, { 
                    text: `Please send a photo for your AI companion. Note: If you skip, you won't be able to get AI-generated images of your companion later. Type 'skip' to continue without a custom image (not recommended).`
                });
            }
            return true;
    }
    
    return false;
}

module.exports = {
    processUserState
};
