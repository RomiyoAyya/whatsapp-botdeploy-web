const path = require('path');
const fs = require('fs-extra');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { saveUserData, getUserData, isPremiumUser, generateImage: utilsGenerateImage, generateCollaborativeImage: utilsGenerateCollaborativeImage } = require('../utils');

// Generate image based on user request
async function generateImage(userId, prompt) {
    try {
        // Get user data
        const userData = await getUserData(userId);
        
        if (!userData) {
            return { success: false, error: "User data not found" };
        }
        
        // Check if user is premium or on free trial
        const isPremium = userData.isPremium;
        const isFreeTrial = userData.isFreeTrial === true;
        
        // Initialize imageRequests if not present
        if (!userData.imageRequests) {
            userData.imageRequests = {};
        }
        
        // Get today's date in YYYY-MM-DD format
        const today = new Date().toISOString().split('T')[0];
        
        // Initialize today's count if not present
        if (!userData.imageRequests[today]) {
            userData.imageRequests[today] = 0;
        }
        
        // Check if user has reached daily limit (3 images per day for free users)
        // Premium users and free trial users have unlimited image generation
        if (!isPremium && !isFreeTrial && userData.imageRequests[today] >= 3) {
            return { 
                success: false, 
                error: "You've reached your daily limit of 3 image generations. Upgrade to premium for unlimited images!" 
            };
        }
        
        // Generate the image
        const imagePath = await utilsGenerateImage(userId, prompt);
        
        if (imagePath) {
            // Increment image request count for non-premium users who aren't on free trial
            if (!isPremium && !isFreeTrial) {
                userData.imageRequests[today] = (userData.imageRequests[today] || 0) + 1;
                userData.imageGenerationCount = (userData.imageGenerationCount || 0) + 1;
                userData.lastImageGenerationTime = new Date().toISOString();
                await saveUserData(userId, userData);
            }
            return { success: true, imagePath: imagePath };
        } else {
            return { success: false, error: "Failed to generate image" };
        }
    } catch (error) {
        console.error('Error generating image:', error);
        return { success: false, error: "An error occurred while generating the image" };
    }
}

// Handle collaborative image generation
async function handleCollaborativeImage(sock, message) {
    const userId = message.key.remoteJid;
    
    try {
        // Check if user is premium
        const isPremium = await isPremiumUser(userId);
        
        // Get user data
        const userData = await getUserData(userId);
        
        if (!userData) {
            await sock.sendMessage(userId, { 
                text: "✨ Welcome! I notice you don't have an AI companion yet.\n\n🤖 Type */create* to begin your magical journey with your very own AI friend!\n\n💡 Need help? Type */help* to discover all the amazing features and commands available to you! Let's make something special together! ✨" 
            });
            return;
        }
        
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
        
        // Extract prompt from caption
        const caption = message.message.imageMessage.caption || '';
        const prompt = caption.replace('/collob', '').trim();
        
        if (!prompt) {
            await sock.sendMessage(userId, { 
                text: "Please provide a description for our collaborative image. For example: '/collob us at the beach'" 
            });
            return;
        }
        
        await sock.sendMessage(userId, { text: "Creating our photo together... This might take a moment! 📸✨" });
        
        // Download the user's image
        const userImageBuffer = await downloadMediaMessage(
            message,
            'buffer',
            {},
            {}
        );
        
        // Save user image temporarily
        const userImagePath = path.join(process.cwd(), 'temp', `${userId.split('@')[0]}_user.jpg`);
        await fs.ensureDir(path.dirname(userImagePath));
        await fs.writeFile(userImagePath, userImageBuffer);
        
        // Generate collaborative image
        const fullPrompt = `${userData.userName} and ${userData.companionName} together ${prompt}`;
        const imagePath = await generateCollaborativeImage(userId, fullPrompt, userImagePath);
        
        if (imagePath) {
            // Send the image
            await sock.sendMessage(userId, {
                image: { url: imagePath },
                caption: "Here's our photo together! I love how it turned out! 💖"
            });
            
            // Increment image count
            userData.imageRequests[today] = (userData.imageRequests[today] || 0) + 1;
            userData.imageGenerationCount = (userData.imageGenerationCount || 0) + 1;
            userData.lastImageGenerationTime = Date.now();
            await saveUserData(userId, userData);
            
            // Delete the temporary files
            try {
                fs.unlinkSync(userImagePath);
                fs.unlinkSync(imagePath);
            } catch (deleteError) {
                console.error(`Error deleting temporary files: ${deleteError.message}`);
            }
        } else {
            await sock.sendMessage(userId, { 
                text: "I'm sorry, I couldn't create our photo together. Let's try again later! 💫" 
            });
        }
    } catch (error) {
        console.error('Error handling collaborative image:', error);
        await sock.sendMessage(userId, { 
            text: "Oops! Something went wrong while creating our photo. Let's try again later! 📸✨" 
        });
    }
}

// Generate collaborative image
async function generateCollaborativeImage(userId, prompt, userImagePath) {
    try {
        // Call the function from utils.js with the correct parameter order
        return await utilsGenerateCollaborativeImage(userId, userImagePath, prompt);
    } catch (error) {
        console.error('Error generating collaborative image:', error);
        return null;
    }
}

// When sending character images
async function sendCharacterImage(sock, userId) {
    try {
        const userData = await getUserData(userId);
        if (!userData || !userData.characterImagePath) {
            await sock.sendMessage(userId, { 
                text: "I don't have a profile picture yet!" 
            });
            return;
        }
        
        // Get the absolute path from the relative path stored in userData
        const imagePath = getCharacterImagePath(userData.characterImagePath);
        
        if (!fs.existsSync(imagePath)) {
            await sock.sendMessage(userId, { 
                text: "I'm sorry, I can't find my profile picture!" 
            });
            return;
        }
        
        await sock.sendMessage(userId, {
            image: { url: imagePath },
            caption: "Here's my picture! 😊"
        });
    } catch (error) {
        console.error('Error sending character image:', error);
        await sock.sendMessage(userId, { 
            text: "I'm sorry, I couldn't send my picture right now." 
        });
    }
}

module.exports = {
    generateImage,
    handleCollaborativeImage
};