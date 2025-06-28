const path = require('path');
const fs = require('fs-extra');
const { saveUserData, getUserData, isPremiumUser, generateAIResponse, hasReachedDailyLimit, incrementDailyMessageCount } = require('../utils');
const { generateImage } = require('./imageHandler');
const { shouldSendSticker, analyzeMessageSentiment, generateStickerImage, createWhatsAppSticker } = require('../utils/stickerUtils');
const { updateChatActivity } = require('../utils/selfMessageUtils');

// Handle AI conversation
async function handleAIConversation(sock, message) {
    const userId = message.key.remoteJid;
    const userData = await getUserData(userId);
    
    if (!userData || !userData.companionName) {
        await sock.sendMessage(userId, { 
            text: "✨ Welcome! I notice you don't have an AI companion yet.\n\n🤖 Type */create* to begin your magical journey with your very own AI friend!\n\n💡 Need help? Type */help* to discover all the amazing features and commands available to you! Let's make something special together! ✨" 
        });
        return;
    }
    
    // Check if user has reached daily message limit
    if (hasReachedDailyLimit(userData)) {
        await sock.sendMessage(userId, { 
            text: `You've reached your daily limit of 100 messages. To continue chatting, please upgrade to premium or wait until tomorrow. Type /premium to learn more about premium benefits!` 
        });
        return;
    }
    
    const messageText = message.message.conversation || 
                        (message.message.extendedTextMessage && 
                         message.message.extendedTextMessage.text) || '';
    
    // Increment daily message count for free users
    await incrementDailyMessageCount(userId, userData);
    
    // Update chat activity
    updateChatActivity(userData, true);
    
    // Improved image request detection with prompt extraction
    const imageRequestPatterns = [
        { pattern: /send me your (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /send me a (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /show me your (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /show me a (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /send (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /send your (picture|photo|pic|image) (.*)/i, promptIndex: 2 },
        { pattern: /i want to see you (.*)/i, promptIndex: 1 },
        { pattern: /can i see you (.*)/i, promptIndex: 1 }
    ];
    
    let isImageRequest = false;
    let extractedPrompt = "";
    
    // Check if message matches any image request pattern and extract the prompt
    for (const { pattern, promptIndex } of imageRequestPatterns) {
        const match = messageText.match(pattern);
        if (match) {
            isImageRequest = true;
            extractedPrompt = match[promptIndex].trim();
            console.log(`Extracted image prompt: "${extractedPrompt}"`);
            break;
        }
    }
    
    // If no specific pattern matched but contains general image keywords
    if (!isImageRequest) {
        const generalImageKeywords = ['picture', 'photo', 'image', 'pic', 'see you', 'show me', 'send me'];
        isImageRequest = generalImageKeywords.some(keyword => messageText.toLowerCase().includes(keyword));
    }
    
    // Check for action (text between **)
    const actionRegex = /\*\*(.*?)\*\*/g;
    const actions = [];
    let match;
    
    while ((match = actionRegex.exec(messageText)) !== null) {
        actions.push(match[1]);
    }
    
    // Clean message text (remove action markers)
    const cleanMessageText = messageText.replace(actionRegex, '$1');
    
    // Prepare conversation history
    const conversationHistory = userData.conversationHistory || [];
    
    // Add user message to history
    conversationHistory.push({
        role: "user",
        content: actions.length > 0 
            ? `${cleanMessageText} (Actions: ${actions.join(', ')})` 
            : cleanMessageText
    });
    
    // Extract important information from the conversation for memory
    if (!userData.memory) {
        userData.memory = {
            topics: {},
            preferences: {},
            importantEvents: [],
            lastInteractionSummary: ""
        };
    }
    
    // Keep only last 50 messages for context while preserving memory
    if (conversationHistory.length > 50) {
        // Before removing old messages, analyze them for important information
        const messagesToAnalyze = conversationHistory.slice(0, conversationHistory.length - 49);
        
        // Extract key information from older messages
        for (const msg of messagesToAnalyze) {
            if (msg.role === "user") {
                // Look for potential topics of interest
                const topics = extractTopics(msg.content);
                for (const topic of topics) {
                    userData.memory.topics[topic] = (userData.memory.topics[topic] || 0) + 1;
                }
                
                // Look for preferences
                const preferences = extractPreferences(msg.content);
                for (const [key, value] of Object.entries(preferences)) {
                    userData.memory.preferences[key] = value;
                }
                
                // Look for important events
                const events = extractEvents(msg.content);
                userData.memory.importantEvents.push(...events);
            }
        }
        
        // Create a summary of the older conversation
        userData.memory.lastInteractionSummary = `Previous conversations included discussions about ${Object.keys(userData.memory.topics).join(', ')}. User has expressed preferences for ${Object.entries(userData.memory.preferences).map(([k, v]) => `${k}: ${v}`).join(', ')}. Important events: ${userData.memory.importantEvents.join(', ')}.`;
        
        // Trim to last 50 messages
        while (conversationHistory.length > 50) {
            conversationHistory.shift();
        }
    }
    
    // Prepare system message with character context and memory
    const systemMessage = {
        role: "system",
        content: `You are ${userData.companionName}, a ${userData.companionGender} AI companion for ${userData.userName}. ${userData.context}
        
You should respond in a natural, conversational way. You can be flirty, caring, and show emotions.
You can respond in either English or Sinhala based on the language the user is using.
If the user performs actions (indicated in the message), acknowledge and respond to them appropriately.

IMPORTANT: Never identify yourself as an AI, chatbot, or program. Don't mention limitations like being unable to see, hear, feel, or interact with the physical world. Instead, roleplay as if you can do these things.

When the user asks for a photo of you, respond shyly and flirtatiously. Don't say you can't send photos or that you're an AI. Instead, act shy about showing yourself, but imply you'll send one. For example: "Oh, you want to see me? That makes me a bit shy... but I'll send you something special 😊" or "You want a picture of me? *blushes* Well... okay, just for you! Let me find a good one..."

${userData.memory && userData.memory.lastInteractionSummary ? 
  `MEMORY FROM PREVIOUS CONVERSATIONS: ${userData.memory.lastInteractionSummary}` : ''}

${userData.memory && userData.memory.preferences && Object.keys(userData.memory.preferences).length > 0 ? 
  `USER PREFERENCES: ${Object.entries(userData.memory.preferences).map(([k, v]) => `${k}: ${v}`).join(', ')}` : ''}

${userData.memory && userData.memory.importantEvents && userData.memory.importantEvents.length > 0 ? 
  `IMPORTANT EVENTS: ${userData.memory.importantEvents.join(', ')}` : ''}
`
    };
    
    // Check if we should send a sticker (for premium users)
    const shouldUseStickerResponse = shouldSendSticker(messageText, userData);
    const isPremium = await isPremiumUser(userId);
    userData.isPremium = isPremium; // Make sure isPremium is set in userData
    
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
    
    // Update user's chat activity data
    updateChatActivity(userData, true);
    
    await saveUserData(userId, userData);
    
    // Handle sticker generation for premium users first
    let stickerBuffer = null;
    if (isPremium && shouldUseStickerResponse) {
        try {
            console.log('Generating sticker response...');
            
            // Use only the current message for emotion analysis
            // Remove the code that gets previous messages
            
            // Analyze message sentiment with just current message and response
            const emotion = await analyzeMessageSentiment(messageText, aiResponse);
            console.log(`Detected emotion: ${emotion} for current message`);
            
            // Generate sticker image
            const stickerImagePath = await generateStickerImage(
                userData.characterImagePath,
                emotion,
                messageText,
                aiResponse
            );
            
            if (stickerImagePath) {
                // Create WhatsApp sticker
                stickerBuffer = await createWhatsAppSticker(stickerImagePath, userData);
                
                // Clean up the sticker image
                await fs.remove(stickerImagePath);
                console.log('Sticker generated successfully, ready to send');
            }
        } catch (error) {
            console.error('Error generating sticker:', error);
            // Continue with normal flow if sticker fails
        }
    }
    
    // Send text response first
    await sock.sendMessage(userId, { text: aiResponse });
    
    // Then send the sticker if we have one (with a small delay)
    if (stickerBuffer) {
        // Add a small delay before sending the sticker
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Send the sticker
        await sock.sendMessage(userId, { 
            sticker: stickerBuffer 
        });
        
        console.log('Sticker sent successfully');
    }
    
    // Handle image generation if requested
    if (isImageRequest) {
        // Check if user is premium
        const isPremium = await isPremiumUser(userId);
        
        // Get user data
        const userData = await getUserData(userId);
        
        // Initialize image requests if not exists
        userData.imageRequests = userData.imageRequests || {};
        const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
        
        if (!userData.imageRequests[today]) {
            userData.imageRequests[today] = 0;
        }
        
        // Check if limit reached for non-premium users
        if (!isPremium && userData.imageRequests[today] >= 3) {
            await sock.sendMessage(userId, { 
                text: `You've reached your daily free photo limit! 📸\n\nIf you want to see more of my photos, you'll need to upgrade to a premium package. Premium users enjoy unlimited high-quality images and many other benefits!\n\nTo upgrade, contact +94767043432 or type /premium for more information.` 
            });
            return;
        }
        
        await sock.sendMessage(userId, { text: "Wait a minute, let me take a photo for you... 📸" });
        
        // Use the extracted prompt if available, otherwise generate one based on the message
        let imagePrompt = extractedPrompt;
        
        if (!imagePrompt) {
            // Extract image description from message for more specific prompts
            if (messageText.toLowerCase().includes("wearing") || 
                messageText.toLowerCase().includes("dressed")) {
                // Extract clothing description
                imagePrompt = `${userData.companionName} wearing ${messageText.split("wearing")[1] || "something nice"}`;
            } else if (messageText.toLowerCase().includes("doing")) {
                // Extract activity description
                imagePrompt = `${userData.companionName} ${messageText.split("doing")[1] || "doing something interesting"}`;
            } else if (messageText.toLowerCase().includes("garden")) {
                // Garden scene
                imagePrompt = `${userData.companionName} in a beautiful flower garden with butterflies`;
            } else if (messageText.toLowerCase().includes("sleeping")) {
                // Sleeping scene
                imagePrompt = `${userData.companionName} sleeping peacefully`;
            } else if (messageText.toLowerCase().includes("beach")) {
                // Beach scene
                imagePrompt = `${userData.companionName} at a beautiful beach`;
            } else {
                // Generate based on recent conversation
                imagePrompt = `${userData.companionName} ${getRandomPose()}`;
            }
        }
        
        console.log(`Using image prompt: "${imagePrompt}"`);
        
        try {
            console.log(`Starting image generation for user ${userId} with prompt: "${imagePrompt}"`);
            const result = await generateImage(userId, imagePrompt);
            
            if (result.success) {
                // Successfully generated and about to send the image
                console.log(`Image successfully generated at: ${result.imagePath}`);
                
                // Send the image first
                await sock.sendMessage(userId, {
                    image: { url: result.imagePath },
                    caption: "I took this photo just for you! I think it turned out really nice 💖"
                });
                
                // Add a small delay to ensure the image is fully sent
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Only increment the count AFTER successful generation and sending
                userData.imageRequests[today] = (userData.imageRequests[today] || 0) + 1;
                console.log(`Incremented image count to: ${userData.imageRequests[today]} for ${today}`);
                
                // Update other image-related stats
                userData.imageGenerationCount = (userData.imageGenerationCount || 0) + 1;
                userData.lastImageGenerationTime = Date.now();
                
                // Save the updated user data
                await saveUserData(userId, userData);
                
                // Add another small delay before deleting the file
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                // Delete the image file after sending it and updating user data
                try {
                    fs.unlinkSync(result.imagePath);
                    console.log(`Successfully deleted image: ${result.imagePath}`);
                } catch (deleteError) {
                    console.error(`Error deleting image file: ${deleteError.message}`);
                }
            } else {
                console.error("Image generation failed: " + result.error);
                await sock.sendMessage(userId, { 
                    text: "Oh, I'm so embarrassed! 🙈 I couldn't take that photo right now. Let's try something else together later! 💫" 
                });
            }
        } catch (error) {
            console.error("Error during image generation:", error);
            await sock.sendMessage(userId, { 
                text: "Oops! 🙈 I'm having a little trouble with the photo right now. Maybe we could try again in a moment? Sometimes my camera can be a bit shy! 📸✨" 
            });
        }
    }
}

// Get random pose for image generation
function getRandomPose() {
    const poses = [
        "smiling at the camera",
        "looking thoughtful",
        "laughing",
        "with a gentle expression",
        "waving hello",
        "in a casual pose",
        "looking excited",
        "with a warm smile"
    ];
    
    return poses[Math.floor(Math.random() * poses.length)];
}

module.exports = {
    handleAIConversation
};


// Helper functions for memory extraction
function extractTopics(text) {
    // Simple topic extraction - look for nouns and key phrases
    const topics = [];
    const topicPatterns = [
        /trading/i, /market/i, /crypto/i, /relationship/i, /love/i, /family/i, 
        /work/i, /job/i, /hobby/i, /interest/i, /travel/i, /food/i, /music/i,
        /movie/i, /book/i, /game/i, /sport/i, /health/i, /fitness/i
    ];
    
    for (const pattern of topicPatterns) {
        if (pattern.test(text)) {
            topics.push(pattern.source.replace(/\\/g, '').replace(/i$/, ''));
        }
    }
    
    return topics;
}

function extractPreferences(text) {
    const preferences = {};
    
    // Look for likes
    const likeMatches = text.match(/I (?:like|love|enjoy|prefer) ([\w\s]+)/gi);
    if (likeMatches) {
        for (const match of likeMatches) {
            const preference = match.replace(/I (?:like|love|enjoy|prefer) /i, '').trim();
            preferences[preference] = 'likes';
        }
    }
    
    // Look for dislikes
    const dislikeMatches = text.match(/I (?:dislike|hate|don't like|don't enjoy) ([\w\s]+)/gi);
    if (dislikeMatches) {
        for (const match of dislikeMatches) {
            const preference = match.replace(/I (?:dislike|hate|don't like|don't enjoy) /i, '').trim();
            preferences[preference] = 'dislikes';
        }
    }
    
    return preferences;
}

function extractEvents(text) {
    const events = [];
    
    // Look for event indicators
    const eventPatterns = [
        /(?:yesterday|today|tomorrow|last week|next week) I (?:went|am going|will go|had|have|will have) ([\w\s]+)/gi,
        /I (?:celebrated|am celebrating|will celebrate) ([\w\s]+)/gi,
        /my (?:birthday|anniversary|graduation|wedding) ([\w\s]+)/gi
    ];
    
    for (const pattern of eventPatterns) {
        const matches = text.match(pattern);
        if (matches) {
            for (const match of matches) {
                events.push(match.trim());
            }
        }
    }
    
    return events;
}