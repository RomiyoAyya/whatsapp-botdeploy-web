const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const apiKeyManager = require('./apiKeyManager');

// Remove the global genAI initialization since we'll create instances as needed
// const genAI = new GoogleGenerativeAI(apiKeyManager.getNextApiKey('gemini'));

// Setup necessary folders
function setupFolders() {
    const folders = [
        'auth_info_baileys',
        'user_data',
        'character_images',
        'generated_images',
        'temp',
        'voice_messages',
        'config'  // Make sure config folder exists for reminders
    ];
    
    folders.forEach(folder => {
        const folderPath = path.join(process.cwd(), folder);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
    });
}

// Generate image using Gemini 2.0 Flash
async function generateImage(userId, prompt) {
    try {
        // Get user data to find their character image
        const userData = await getUserData(userId);
        if (!userData || !userData.characterImagePath) {
            console.error('No character image found for user');
            return null;
        }
        
        console.log(`Generating image for user ${userId} with prompt: ${prompt}`);

        // Create output directory if it doesn't exist
        const outputDir = path.join(__dirname, '..', 'generated_images');
        fs.ensureDirSync(outputDir);
        
        // Read the character image as base64
        const imageBuffer = fs.readFileSync(userData.characterImagePath);
        const base64Image = imageBuffer.toString('base64');
        
        // Extract character name from user data
        const characterName = userData.companionName || "the person";
        
        // Clean and enhance the prompt
        const cleanPrompt = prompt
            .replace(/send me your picture/i, '')
            .replace(/send me a picture/i, '')
            .replace(/send picture/i, '')
            .replace(/send photo/i, '')
            .replace(/your picture/i, '')
            .trim();
            
        // Create a more specific prompt based on the user's request
        let enhancedPrompt = cleanPrompt;
        if (cleanPrompt.toLowerCase().includes('dress') || cleanPrompt.toLowerCase().includes('wearing')) {
            enhancedPrompt = `wearing ${cleanPrompt}`;
        } else if (cleanPrompt.toLowerCase().includes('sea') || cleanPrompt.toLowerCase().includes('beach')) {
            enhancedPrompt = `at the beach or by the sea, ${cleanPrompt}`;
        } else if (cleanPrompt.toLowerCase().includes('cosplay')) {
            enhancedPrompt = `in a cosplay outfit, ${cleanPrompt}`;
        }
        
        // Get a fresh API key for image generation
        const apiKey = apiKeyManager.getNextApiKey('gemini');
        if (!apiKey) {
            console.error('No valid Gemini API key available');
            return null;
        }
        
        console.log('Using Gemini API key for image generation');
        
        // Create a new instance of the Gemini client with the fresh API key
        const localGenAI = new GoogleGenerativeAI(apiKey);
        
        // Set responseModalities to include "Image" so the model can generate an image
        const model = localGenAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ['Text', 'Image'],
                temperature: 0.1,
                topP: 0.1,
                topK: 8
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_ONLY_HIGH"
                }
            ]
        });

        // Try with the reference image - identity preservation approach
        try {
            // Prepare the content parts with both the image and prompt
            const contents = [
                { 
                    text: `This is a reference photo of a person named ${characterName}. 
                    
                    TASK: Create a photorealistic image of THIS EXACT SAME PERSON ${enhancedPrompt}.
                    
                    CRITICAL REQUIREMENTS:
                    1. The output MUST show the EXACT SAME PERSON as in the reference image
                    2. Maintain the EXACT SAME face shape, eyes, nose, lips, and facial structure
                    3. Keep the same hair color, style, and length
                    4. Preserve the same skin tone and complexion
                    
                    DO NOT change the person's identity or face in any way.
                    Make it appropriate and SFW.
                    
                    This is a portrait continuation task - the face must be identical to the reference.` 
                },
                {
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Image
                    }
                }
            ];

            console.log("Trying image-based generation with strong identity preservation...");
            const response = await model.generateContent(contents);
            
            // Process the response to extract the image
            if (response?.response?.candidates?.[0]?.content?.parts) {
                for (const part of response.response.candidates[0].content.parts) {
                    if (part.inlineData) {
                        const imageData = part.inlineData.data;
                        const buffer = Buffer.from(imageData, 'base64');
                        const outputPath = path.join(outputDir, `${userId}_${Date.now()}.png`);
                        fs.writeFileSync(outputPath, buffer);
                        console.log(`Image saved to ${outputPath}`);
                        return outputPath;
                    }
                }
            }
            
            // If the first approach failed, try with a different prompt formulation
            console.log("First approach failed, trying alternative prompt...");
            
            // Alternative approach with different phrasing
            const alternativeContents = [
                { 
                    text: `Reference image: A person with specific facial features.
                    
                    TASK: Generate a photorealistic image of the EXACT SAME PERSON from the reference image ${enhancedPrompt}.
                    
                    IMPORTANT INSTRUCTIONS:
                    - The person in the output MUST have the IDENTICAL face as in the reference image
                    - Keep the same facial features, hair style, eye color, and overall appearance
                    - Only change the scene/setting/pose as specified in the prompt
                    - The person's identity must remain 100% consistent with the reference image
                    
                    Make it appropriate and SFW.` 
                },
                {
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: base64Image
                    }
                }
            ];
            
            const alternativeResponse = await model.generateContent(alternativeContents);
            
            if (alternativeResponse?.response?.candidates?.[0]?.content?.parts) {
                for (const part of alternativeResponse.response.candidates[0].content.parts) {
                    if (part.inlineData) {
                        const imageData = part.inlineData.data;
                        const buffer = Buffer.from(imageData, 'base64');
                        const outputPath = path.join(outputDir, `${userId}_${Date.now()}.png`);
                        fs.writeFileSync(outputPath, buffer);
                        console.log(`Image saved to ${outputPath} (alternative approach)`);
                        return outputPath;
                    }
                }
            }
            
            // If both approaches failed, log the error and return null
            console.error('Both image generation approaches failed');
            return null;
            
        } catch (innerError) {
            console.error('Error in image generation attempt:', innerError.message);
            throw innerError;
        }
    } catch (error) {
        console.error('Error generating image:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

// Save user data
async function saveUserData(userId, data) {
    try {
        const userDataDir = path.join(process.cwd(), 'user_data');
        if (!fs.existsSync(userDataDir)) {
            fs.mkdirSync(userDataDir, { recursive: true });
        }
        
        // Limit conversation history for premium users to 20 messages (changed from 50)
        // and non-premium users to 10 messages
        if (data.conversationHistory) {
            if (data.isPremium && data.conversationHistory.length > 20) {
                console.log('Limiting conversation history for premium user to 20 messages');
                data.conversationHistory = data.conversationHistory.slice(-20);
            } else if (!data.isPremium && data.conversationHistory.length > 10) {
                console.log('Limiting conversation history for non-premium user to 10 messages');
                data.conversationHistory = data.conversationHistory.slice(-10);
            }
        }
        
        const filePath = path.join(userDataDir, `${userId}.json`);
        await fs.writeJson(filePath, data, { spaces: 2 });
        return true;
    } catch (error) {
        console.error('Error saving user data:', error);
        return false;
    }
}

// Get user data
async function getUserData(userId) {
    try {
        const filePath = path.join(process.cwd(), 'user_data', `${userId}.json`);
        if (fs.existsSync(filePath)) {
            return await fs.readJson(filePath);
        }
        return null;
    } catch (error) {
        console.error('Error getting user data:', error);
        return null;
    }
}

// Save character image function
async function saveCharacterImage(userId, buffer) {
    try {
        const characterImagesDir = path.join(process.cwd(), 'character_images');
        if (!fs.existsSync(characterImagesDir)) {
            fs.mkdirSync(characterImagesDir, { recursive: true });
        }
        
        // Use userId as filename for consistency
        const filename = `${userId.split('@')[0]}.jpg`;
        const filePath = path.join(characterImagesDir, filename);
        
        // Save the buffer to file
        await fs.writeFile(filePath, buffer);
        
        // Return a relative path that works on both Windows and Linux
        return path.join('character_images', filename).replace(/\\/g, '/');
    } catch (error) {
        console.error('Error saving character image:', error);
        return null;
    }
}

// Check if user is premium
async function isPremiumUser(userId) {
    try {
        const userData = await getUserData(userId);
        
        if (!userData) {
            return false;
        }
        
        // If user has premium flag and it's not expired, they're premium
        if (userData.isPremium) {
            // If there's an expiry date, check if it's in the future
            if (userData.premiumExpiry) {
                const expiryDate = new Date(userData.premiumExpiry);
                const now = new Date();
                
                // If premium has expired, update the user data
                if (expiryDate <= now) {
                    userData.isPremium = false;
                    userData.premiumExpiredAt = now.toISOString();
                    
                    // If this was a free trial or task trial, notify the user that it ended
                    if (userData.isFreeTrial || userData.isTaskTrial) {
                        const trialType = userData.isFreeTrial ? 'free' : 'task';
                        userData.isFreeTrial = false;
                        userData.isTaskTrial = false;
                        
                        // Clear memory data when trial expires
                        userData.memory = {
                            topics: {},
                            preferences: {},
                            importantEvents: [],
                            lastInteractionSummary: ""
                        };
                        
                        // Save the updated user data
                        await saveUserData(userId, userData);
                        
                        // Try to notify the user that their trial has ended
                        try {
                            const sock = global.whatsappSocket; // Assuming you store the socket globally
                            if (sock) {
                                const message = userData.taskTrialTaskName ?
                                    `⏰ *Your Task Premium Trial Has Ended* ⏰\n\nYour premium trial from task "${userData.taskTrialTaskName}" has expired. You've been returned to the free tier with limited features. Complete more tasks or type /premium to upgrade!` :
                                    `⏰ *Your Premium Trial Has Ended* ⏰\n\nYour ${trialType} premium trial has expired. You've been returned to the free tier with limited features. Type /premium to upgrade and continue enjoying premium benefits!`;
                                
                                await sock.sendMessage(userId, { text: message });
                            }
                        } catch (notifyError) {
                            console.error(`Error notifying user ${userId} about trial expiry:`, notifyError);
                        }
                    } else {
                        // Save the updated user data
                        await saveUserData(userId, userData);
                    }
                    
                    return false;
                }
                
                return true;
            }
            
            // If no expiry date, assume lifetime premium
            return true;
        }
        
        return false;
    } catch (error) {
        console.error('Error checking premium status:', error);
        return false;
    }
}

// Generate AI response with API key fallback
async function generateAIResponse(messages, userData) {
    // Determine language preference based on the last user message
    const lastUserMessage = messages.find(m => m.role === "user")?.content || "";
    const isSinhala = containsSinhalaText(lastUserMessage);
    
    // Check if we need to update memory based on the conversation
    if (userData && userData.isPremium && userData.conversationHistory && userData.conversationHistory.length > 0) {
        // Initialize the message counter if it doesn't exist
        if (!userData.messagesSinceLastMemoryUpdate) {
            userData.messagesSinceLastMemoryUpdate = 0;
        }
        
        // Increment the counter for each new message
        userData.messagesSinceLastMemoryUpdate += 1;
        
        console.log(`Messages since last memory update: ${userData.messagesSinceLastMemoryUpdate}`);
        
        // Update memory every 20 messages
        if (userData.messagesSinceLastMemoryUpdate >= 20) {
            console.log(`Triggering memory update after ${userData.messagesSinceLastMemoryUpdate} messages`);
            try {
                await updateMemorySummary(userData);
                // Reset the counter after update
                userData.messagesSinceLastMemoryUpdate = 0;
                console.log('Memory update completed successfully');
            } catch (error) {
                console.error('Error updating memory:', error);
            }
        } else {
            console.log(`Skipping memory update: ${userData.messagesSinceLastMemoryUpdate} messages since last update (need 20)`);
        }
    }
    
    try {
        // Try Gemini Flash first if keys are available
        const geminiFlashKey = apiKeyManager.getNextApiKey('gemini_flash');
        if (geminiFlashKey) {
            try {
                console.log('Attempting to use Gemini Flash API...');
                return await generateGeminiFlashResponse(messages, geminiFlashKey, userData);
            } catch (error) {
                console.error('Error with Gemini Flash API:', error);
                // Fall through to next option
            }
        }
        
        // Try OpenRouter next
        const openrouterKey = apiKeyManager.getNextApiKey('openrouter');
        if (openrouterKey) {
            try {
                console.log('Attempting to use OpenRouter API...');
                return await generateOpenRouterResponse(messages, openrouterKey);
            } catch (error) {
                console.error('Error with OpenRouter API:', error);
                // Fall through to next option
            }
        }
        
        // Try regular Gemini as last resort
        const geminiKey = apiKeyManager.getNextApiKey('gemini');
        if (geminiKey) {
            try {
                console.log('Attempting to use Gemini API...');
                return await generateGeminiResponse(messages, geminiKey);
            } catch (error) {
                console.error('Error with Gemini API:', error);
                // Fall through to error message
            }
        }
        
        // If all APIs failed, return error message
        return "I'm having trouble connecting right now. Please try again in a moment.";
    } catch (error) {
        console.error('Error generating AI response:', error);
        return "I'm having trouble connecting right now. Please try again in a moment.";
    }
}

// Function to generate response using OpenRouter API
async function generateOpenRouterResponse(messages, apiKey) {
    try {
        // For OpenRouter, we can use the system message directly as it supports it
        const response = await axios.post(
            'https://openrouter.ai/api/v1/chat/completions',
            {
                model: "google/gemini-2.0-flash-exp:free",
                messages: messages,
                max_tokens: 8000 // Increased token limit for longer responses
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://whatsapp-ai-companion.com',
                    'X-Title': 'WhatsApp AI Companion'
                }
            }
        );
        
        // Extract and return the response text
        if (response.data && 
            response.data.candidates && 
            response.data.candidates[0] && 
            response.data.candidates[0].content && 
            response.data.candidates[0].content.parts && 
            response.data.candidates[0].content.parts[0]) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Unexpected response format from Gemini Flash API');
        }
    } catch (error) {
        console.error('Error with OpenRouter API:', error.message);
        throw error;
    }
}

// Function to generate response using Gemini Flash API
async function generateGeminiFlashResponse(messages, apiKey, userData) {
    try {
        // Extract the system message - this contains the character context
        const systemMessage = messages.find(msg => msg.role === 'system')?.content || '';
        
        // Add memory context for premium users
        let enhancedSystemMessage = systemMessage;
        if (userData && userData.isPremium && userData.memory && userData.memory.lastInteractionSummary) {
            enhancedSystemMessage += `\n\nPrevious conversation context: ${userData.memory.lastInteractionSummary}`;
            
            // Add user preferences if available
            if (Object.keys(userData.memory.preferences).length > 0) {
                enhancedSystemMessage += `\n\nUser preferences: ${Object.entries(userData.memory.preferences)
                    .map(([item, preference]) => `${item}: ${preference}`)
                    .join(', ')}`;
            }
        }
        
        // Format messages for Gemini Flash API
        const formattedMessages = [];
        
        // Create a conversation history without system messages
        const conversationHistory = messages.filter(msg => msg.role !== 'system');
        
        // Add all previous messages without the system prompt
        for (let i = 0; i < conversationHistory.length - 1; i++) {
            const msg = conversationHistory[i];
            formattedMessages.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
        
        // Only add the system message to the last user message
        if (conversationHistory.length > 0) {
            const lastMsg = conversationHistory[conversationHistory.length - 1];
            if (lastMsg.role === 'user') {
                formattedMessages.push({
                    role: 'user',
                    parts: [{ text: `${enhancedSystemMessage}\n\nUser message: ${lastMsg.content}\n\nRespond as the character described above, maintaining the personality and context.` }]
                });
            } else {
                // If the last message is from the assistant, just add it normally
                formattedMessages.push({
                    role: 'model',
                    parts: [{ text: lastMsg.content }]
                });
            }
        }
        
        // If there are no messages, create a dummy one with the system message
        if (formattedMessages.length === 0) {
            formattedMessages.push({
                role: 'user',
                parts: [{ text: `${enhancedSystemMessage}\n\nPlease respond as the character described above.` }]
            });
        }
        
        // Make API request to Gemini Flash
        const response = await axios.post(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
            {
                contents: formattedMessages,
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.95,
                    topK: 40,
                    maxOutputTokens: 1024,
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': apiKey
                }
            }
        );
        
        // Extract and return the response text
        if (response.data && 
            response.data.candidates && 
            response.data.candidates[0] && 
            response.data.candidates[0].content && 
            response.data.candidates[0].content.parts && 
            response.data.candidates[0].content.parts[0]) {
            return response.data.candidates[0].content.parts[0].text;
        } else {
            throw new Error('Unexpected response format from Gemini Flash API');
        }
    } catch (error) {
        console.error('Error with Gemini Flash API:', error.response?.data || error.message);
        throw error;
    }
}

// Function to generate response using standard Gemini API
async function generateGeminiResponse(messages, apiKey) {
    try {
        // Create a new instance of the Gemini client with the API key
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
        
        // Extract the system message - this contains the character context
        const systemMessage = messages.find(msg => msg.role === 'system')?.content || '';
        
        // Format messages for Gemini API - similar approach to Gemini Flash
        const formattedMessages = [];
        
        // We need to include the system message with EVERY user message to maintain context
        messages.forEach(msg => {
            if (msg.role === 'user') {
                // For each user message, prepend the system message to maintain character context
                formattedMessages.push({
                    role: 'user',
                    parts: [{ text: `${systemMessage}\n\nUser message: ${msg.content}\n\nRespond as the character described above, maintaining the personality and context.` }]
                });
            } else if (msg.role === 'assistant') {
                formattedMessages.push({
                    role: 'model',
                    parts: [{ text: msg.content }]
                });
            }
        });
        
        // If there are no user messages, create a dummy one with the system message
        if (formattedMessages.length === 0) {
            formattedMessages.push({
                role: 'user',
                parts: [{ text: `${systemMessage}\n\nPlease respond as the character described above.` }]
            });
        }
        
        // Create a chat session with the formatted messages
        const chat = model.startChat({
            history: formattedMessages,
            generationConfig: {
                temperature: 0.7,
                topP: 0.95,
                topK: 40,
                maxOutputTokens: 1024,
            }
        });
        
        // Send a simple prompt to get a response
        // Get the summary
        const result = await chat.sendMessage("Please analyze this conversation and provide the JSON response as requested.");
        const response = result.response.text();
        
        try {
        // Clean the response before parsing
        // Remove markdown code block indicators and any other non-JSON characters
        let cleanedResponse = response;
        
        // Remove markdown code blocks if present (```json and ```)
        cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
        
        // Remove any other markdown formatting
        cleanedResponse = cleanedResponse.replace(/```[a-z]*\s*|\s*```/g, '');
        
        // Ensure we have valid JSON by finding the first { and last }
        const firstBrace = cleanedResponse.indexOf('{');
        const lastBrace = cleanedResponse.lastIndexOf('}');
        
        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
        }
        
        console.log('Cleaned JSON response:', cleanedResponse);
        
        // Parse the cleaned JSON response
        const memoryData = JSON.parse(cleanedResponse);
        
        // Update the memory
        if (memoryData.topics) {
            for (const topic of memoryData.topics) {
                userData.memory.topics[topic] = (userData.memory.topics[topic] || 0) + 1;
            }
        }
        
        if (memoryData.preferences) {
            Object.assign(userData.memory.preferences, memoryData.preferences);
        }
        
        if (memoryData.events) {
            userData.memory.importantEvents.push(...memoryData.events);
            // Keep only unique events
            userData.memory.importantEvents = [...new Set(userData.memory.importantEvents)];
        }
        
        if (memoryData.summary) {
            userData.memory.lastInteractionSummary = memoryData.summary;
        }
        } catch (jsonError) {
            console.error('Error parsing memory JSON:', jsonError);
            // If JSON parsing fails, use regex to extract information
            extractMemoryManually(response, userData.memory);
        }
    } catch (error) {
        console.error('Error with Gemini API:', error);
        throw error;
    }
}

// Helper function to retry with a new API key
async function retryWithNewKey(messages, apiKey, service) {
    try {
        if (service === 'openrouter') {
            return await generateOpenRouterResponse(messages, apiKey);
        } else if (service === 'gemini') {
            return await generateGeminiResponse(messages, apiKey);
        } else if (service === 'gemini_flash') {
            return await generateGeminiFlashResponse(messages, apiKey);
        } else {
            throw new Error(`Unknown service: ${service}`);
        }
    } catch (retryError) {
        console.error(`Error with secondary ${service} API key:`, retryError);
        throw retryError;
    }
}

// Helper function to detect Sinhala text
function containsSinhalaText(text) {
    // Sinhala Unicode range: U+0D80 to U+0DFF
    const sinhalaPattern = /[\u0D80-\u0DFF]/;
    return sinhalaPattern.test(text);
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

// Generate collaborative image using both user uploaded image and character image
async function generateCollaborativeImage(userId, userImagePath, prompt) {
    try {
        // Get user data to find their character image
        const userData = await getUserData(userId);
        if (!userData || !userData.characterImagePath) {
            console.error('No character image found for user');
            return null;
        }
        
        console.log(`Generating collaborative image for user ${userId} with prompt: ${prompt}`);

        // Create output directory if it doesn't exist
        const outputDir = path.join(__dirname, '..', 'generated_images');
        fs.ensureDirSync(outputDir);
        
        // Read both images as base64
        const characterImageBuffer = fs.readFileSync(userData.characterImagePath);
        const characterBase64Image = characterImageBuffer.toString('base64');
        
        const userImageBuffer = fs.readFileSync(userImagePath);
        const userBase64Image = userImageBuffer.toString('base64');
        
        // Get a fresh API key for image generation
        const apiKey = apiKeyManager.getNextApiKey('gemini');
        if (!apiKey) {
            console.error('No valid Gemini API key available');
            return null;
        }
        
        console.log('Using Gemini API key for collaborative image generation');
        
        // Create a new instance of the Gemini client with the fresh API key
        const localGenAI = new GoogleGenerativeAI(apiKey);
        
        // Set up the Gemini model
        const model = localGenAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ['Text', 'Image']
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                    threshold: "BLOCK_ONLY_HIGH"
                },
                {
                    category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                    threshold: "BLOCK_ONLY_HIGH"
                }
            ]
        });

        // Prepare the content parts with both images and the prompt
        const contents = [
            { 
                text: `Create a new image showing these two people ${prompt}. 
                The first image is the AI character, and the second image is the user.
                Make sure both people appear in the output image together in the scenario described.
                Keep their facial features and appearance consistent with the reference images.
                Make it appropriate and SFW.` 
            },
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: characterBase64Image
                }
            },
            {
                inlineData: {
                    mimeType: 'image/jpeg',
                    data: userBase64Image
                }
            }
        ];

        console.log("Generating collaborative image with both people...");
        const response = await model.generateContent(contents);
        
        // Process the response to extract the image
        if (response?.response?.candidates?.[0]?.content?.parts) {
            for (const part of response.response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const imageData = part.inlineData.data;
                    const buffer = Buffer.from(imageData, 'base64');
                    const outputPath = path.join(outputDir, `collab_${userId}_${Date.now()}.png`);
                    fs.writeFileSync(outputPath, buffer);
                    console.log(`Collaborative image saved to ${outputPath}`);
                    return outputPath;
                }
            }
        }
        
        console.error('No image data found in response');
        return null;
    } catch (error) {
        console.error('Error generating collaborative image:', error.message);
        if (error.response) {
            console.error('Response data:', error.response.data);
        }
        return null;
    }
}

/**
 * Check if user has reached daily message limit
 * @param {Object} userData - User data
 * @returns {boolean} - Whether user has reached daily message limit
 */
// Check if user has reached daily message limit
function hasReachedDailyLimit(userData) {
    // Premium users have no limit
    if (userData.isPremium) {
        return false;
    }
    
    /// Free trial and task trial users also have no limit
    if (userData.isFreeTrial || userData.isTaskTrial) {
        return false;
    }
    
    // Initialize daily messages if not present
    if (!userData.dailyMessages) {
        userData.dailyMessages = {
            count: 0,
            date: new Date().toISOString().split('T')[0]
        };
        return false;
    }
    
    // Check if it's a new day
    const today = new Date().toISOString().split('T')[0];
    if (userData.dailyMessages.date !== today) {
        userData.dailyMessages = {
            count: 0,
            date: today
        };
        return false;
    }
    
    // Check if user has reached the limit (100 messages per day)
    return userData.dailyMessages.count >= 100;
}

/**
 * Increment daily message count for user
 * @param {string} userId - User ID
 * @param {Object} userData - User data
 */
async function incrementDailyMessageCount(userId, userData) {
    // Skip for premium users
    if (userData.isPremium) {
        return;
    }
    
    const currentDate = new Date().toISOString().split('T')[0];
    
    // Initialize daily message tracking if it doesn't exist
    if (!userData.dailyMessages) {
        userData.dailyMessages = {
            count: 1,
            date: currentDate
        };
    } else if (userData.dailyMessages.date !== currentDate) {
        // Reset counter if it's a new day
        userData.dailyMessages.count = 1;
        userData.dailyMessages.date = currentDate;
    } else {
        // Increment counter
        userData.dailyMessages.count++;
    }
    
    // Save updated user data
    await saveUserData(userId, userData);
}

// Function to update memory summary using AI
async function updateMemorySummary(userData) {
    try {
        console.log('Starting memory update process...');
        
        // Only proceed if we have enough conversation history
        if (!userData.conversationHistory || userData.conversationHistory.length < 10) {
            console.log('Not enough conversation history for memory update');
            return;
        }
        
        // Check if user is premium - only premium users get memory features
        if (!userData.isPremium) {
            console.log('Skipping memory update for non-premium user');
            return;
        }
        
        // Initialize memory object if it doesn't exist
        if (!userData.memory) {
            userData.memory = {
                topics: {},
                preferences: {},
                importantEvents: [],
                lastInteractionSummary: ""
            };
        }
        
        console.log(`Updating memory for conversation with ${userData.conversationHistory.length} messages`);
        
        // Get the last 20 messages for summarization
        const recentMessages = userData.conversationHistory.slice(-20);
        
        // Create a system message for the summarization request
        const systemMessage = {
            role: "system",
            content: `You are an AI assistant that extracts key information from conversations. 
            Please analyze the following conversation and extract:
            1. Main topics discussed
            2. User preferences (likes and dislikes)
            3. Important events mentioned
            4. A brief summary of the conversation
            
            Format your response as JSON with the following structure:
            {
                "topics": ["topic1", "topic2"],
                "preferences": {"item1": "likes", "item2": "dislikes"},
                "events": ["event1", "event2"],
                "summary": "Brief summary of the conversation"
            }`
        };
        
        // Try to use any available API for summarization
        const geminiKey = apiKeyManager.getNextApiKey('gemini');
        if (geminiKey) {
            try {
                const genAI = new GoogleGenerativeAI(geminiKey);
                // Fix: Correct model parameter syntax
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
                
                // Format the conversation for summarization
                const formattedMessages = [
                    {
                        role: 'user',
                        parts: [{ text: `${systemMessage.content}\n\nHere's the conversation:\n${recentMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}` }]
                    }
                ];
                
                // Create a chat session
                const chat = model.startChat({
                    history: formattedMessages,
                    generationConfig: {
                        temperature: 0.2,
                        topP: 0.95,
                        topK: 40,
                        maxOutputTokens: 1024,
                    }
                });
                
                // Get the summary
                const result = await chat.sendMessage("Please analyze this conversation and provide the JSON response as requested.");
                const response = result.response.text();
                
                try {
                    // Clean the response before parsing
                    let cleanedResponse = response;
                    
                    // Remove markdown code blocks if present (```json and ```)
                    cleanedResponse = cleanedResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '');
                    
                    // Ensure we have valid JSON by finding the first { and last }
                    const firstBrace = cleanedResponse.indexOf('{');
                    const lastBrace = cleanedResponse.lastIndexOf('}');
                    
                    if (firstBrace !== -1 && lastBrace !== -1) {
                        cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
                    }
                    
                    console.log('Cleaned JSON response:', cleanedResponse);
                    
                    // Parse the cleaned JSON response
                    const memoryData = JSON.parse(cleanedResponse);
                    
                    // Update the memory
                    if (memoryData.topics) {
                        for (const topic of memoryData.topics) {
                            userData.memory.topics[topic] = (userData.memory.topics[topic] || 0) + 1;
                        }
                    }
                    
                    if (memoryData.preferences) {
                        Object.assign(userData.memory.preferences, memoryData.preferences);
                    }
                    
                    if (memoryData.events) {
                        userData.memory.importantEvents.push(...memoryData.events);
                        // Keep only unique events
                        userData.memory.importantEvents = [...new Set(userData.memory.importantEvents)];
                    }
                    
                    if (memoryData.summary) {
                        userData.memory.lastInteractionSummary = memoryData.summary;
                    }
                } catch (jsonError) {
                    console.error('Error parsing memory JSON:', jsonError);
                    // If JSON parsing fails, use regex to extract information
                    extractMemoryManually(response, userData.memory);
                }
            } catch (error) {
                console.error('Error updating memory summary:', error);
                // Fall back to manual extraction
                extractMemoryFromConversation(recentMessages, userData.memory);
            }
        } else {
            // If no API is available, use manual extraction
            extractMemoryFromConversation(recentMessages, userData.memory);
        }
    } catch (error) {
        console.error('Error in memory update:', error);
    }
}

// Manual memory extraction as a fallback
function extractMemoryFromConversation(messages, memory) {
    for (const msg of messages) {
        if (msg.role === "user") {
            // Extract topics, preferences, and events using the helper functions
            const topics = extractTopics(msg.content);
            for (const topic of topics) {
                memory.topics[topic] = (memory.topics[topic] || 0) + 1;
            }
            
            const preferences = extractPreferences(msg.content);
            Object.assign(memory.preferences, preferences);
            
            const events = extractEvents(msg.content);
            memory.importantEvents.push(...events);
            // Keep only unique events
            memory.importantEvents = [...new Set(memory.importantEvents)];
        }
    }
    
    // Create a simple summary
    const topTopics = Object.entries(memory.topics)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([topic]) => topic);
    
    memory.lastInteractionSummary = `Previous conversations included discussions about ${topTopics.join(', ')}. User has expressed preferences for ${Object.entries(memory.preferences).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(', ')}. Important events: ${memory.importantEvents.slice(0, 3).join(', ')}.`;}
// Extract memory manually from AI response when JSON parsing fails
function extractMemoryManually(text, memory) {
    // Extract topics
    const topicsMatch = text.match(/topics"?\s*:?\s*\[([^\]]+)\]/i);
    if (topicsMatch && topicsMatch[1]) {
        const topics = topicsMatch[1].split(',').map(t => t.trim().replace(/"/g, ''));
        for (const topic of topics) {
            if (topic) memory.topics[topic] = (memory.topics[topic] || 0) + 1;
        }
    }
    
    // Extract preferences
    const preferencesMatch = text.match(/preferences"?\s*:?\s*\{([^}]+)\}/i);
    if (preferencesMatch && preferencesMatch[1]) {
        const prefPairs = preferencesMatch[1].split(',');
        for (const pair of prefPairs) {
            const [key, value] = pair.split(':').map(p => p.trim().replace(/"/g, ''));
            if (key && value) memory.preferences[key] = value;
        }
    }
    
    // Extract events
    const eventsMatch = text.match(/events"?\s*:?\s*\[([^\]]+)\]/i);
    if (eventsMatch && eventsMatch[1]) {
        const events = eventsMatch[1].split(',').map(e => e.trim().replace(/"/g, ''));
        for (const event of events) {
            if (event) memory.importantEvents.push(event);
        }
        // Keep only unique events
        memory.importantEvents = [...new Set(memory.importantEvents)];
    }
    
    // Extract summary
    const summaryMatch = text.match(/summary"?\s*:?\s*"([^"]+)"/i);
    if (summaryMatch && summaryMatch[1]) {
        memory.lastInteractionSummary = summaryMatch[1];
    }
}

// Add these helper functions before the module.exports

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

// Now update the module.exports to include these functions
module.exports = {
    setupFolders,
    saveUserData,
    getUserData,
    saveCharacterImage,
    isPremiumUser,
    generateAIResponse,
    containsSinhalaText,
    generateImage,
    getRandomPose,
    generateCollaborativeImage,
    extractTopics,
    extractPreferences,
    extractEvents,
    updateMemorySummary,
    hasReachedDailyLimit,         
    incrementDailyMessageCount
};