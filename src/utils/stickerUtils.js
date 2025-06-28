const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const { Sticker, StickerTypes } = require('wa-sticker-formatter');
const apiKeyManager = require('../apiKeyManager');

// Styles for sticker generation
const STICKER_STYLES = [
    "cute anime style with clean lines",
    "simple anime style with minimal details",
    "kawaii anime style with big eyes"
];

// Expressions for sticker generation
const EXPRESSIONS = {
    happy: ["smiling", "grinning", "laughing", "joyful", "excited"],
    sad: ["frowning", "teary-eyed", "crying", "disappointed", "melancholic"],
    angry: ["frowning", "glaring", "pouting", "irritated", "furious"],
    surprised: ["wide-eyed", "shocked", "mouth open", "gasping", "amazed"],
    confused: ["raised eyebrow", "puzzled", "scratching head", "tilted head", "uncertain"],
    love: ["heart eyes", "blushing", "blowing kiss", "romantic pose", "loving gaze"],
    cute: ["big eyes", "head tilt", "peace sign", "adorable pose", "kawaii expression"]
};

// Messages that could trigger sticker responses
const STICKER_TRIGGER_PHRASES = [
    "ok", "okay", "sure", "yes", "no", "maybe", "hmm", "huh", "wow", "cool", 
    "nice", "great", "awesome", "amazing", "good", "bad", "lol", "haha", 
    "thanks", "thank you", "welcome", "hi", "hello", "hey", "bye", "goodbye",
    "goodnight", "morning", "evening", "love", "miss", "cute", "pretty", "beautiful"
];

/**
 * Determines if a message should get a sticker response
 * @param {string} message - The user's message
 * @param {Object} userData - User data
 * @returns {boolean} - Whether to send a sticker
 */
function shouldSendSticker(message, userData) {
    // Only for premium users
    if (!userData.isPremium) {
        return false;
    }
    
    // Check if message is short or contains trigger phrases
    const isShortMessage = message.split(' ').length <= 5;
    const containsTriggerPhrase = STICKER_TRIGGER_PHRASES.some(phrase => 
        message.toLowerCase().includes(phrase.toLowerCase())
    );
    
    // Random chance (30% for short messages, 15% for messages with trigger phrases, 5% otherwise)
    const randomChance = Math.random();
    if (isShortMessage && randomChance < 0.3) {
        return true;
    } else if (containsTriggerPhrase && randomChance < 0.15) {
        return true;
    } else if (randomChance < 0.05) {
        return true;
    }
    
    return false;
}

/**
 * Analyzes message sentiment to determine appropriate expression
 * @param {string} message - The user's message
 * @param {string} aiResponse - The AI's text response
 * @returns {string} - The expression to use
 */
// Analyzes message sentiment to determine appropriate expression
async function analyzeMessageSentiment(message, aiResponse) {
    try {
        const geminiKey = apiKeyManager.getNextApiKey('gemini');
        if (!geminiKey) {
            return getRandomExpression('happy'); // Default to happy if no API key
        }
        
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const prompt = `
        Analyze this conversation exchange to determine the most appropriate emotional expression for a sticker response.
        
        User message: "${message}"
        AI response: "${aiResponse}"
        
        First, identify the dominant emotion in the USER'S message (are they happy, sad, angry, etc?).
        Then, determine how the AI SHOULD respond emotionally based on both the user's emotion and the AI's actual text response.
        
        For example:
        - If user is sad and AI is comforting them, choose "love" or "sad" (empathetic)
        - If user is happy and AI is sharing excitement, choose "happy" or "surprised"
        - If user is angry and AI is calming them, choose "love" or "cute"
        - If user is confused and AI is explaining, choose "happy" or "cute"
        - If user is flirty and AI is responding positively, choose "love" or "cute"
        - If user is brief/neutral, match the AI's emotional tone in the response
        
        Choose ONE of these emotions that best matches how the AI character should respond:
        - happy (for joyful, excited, pleased responses)
        - sad (for empathetic, sorry, disappointed responses)
        - angry (for frustrated, annoyed, upset responses)
        - surprised (for shocked, amazed, astonished responses)
        - confused (for uncertain, puzzled, questioning responses)
        - love (for romantic, caring, affectionate responses)
        - cute (for playful, shy, adorable responses)
        
        Reply with just the emotion name, nothing else.`;
        
        const result = await model.generateContent(prompt);
        const response = result.response.text().trim().toLowerCase();
        
        console.log(`Emotion analysis result: "${response}" for message: "${message.substring(0, 30)}..."`);
        
        // Check if response is one of our defined emotions
        if (Object.keys(EXPRESSIONS).includes(response)) {
            return response;
        } else {
            // If response doesn't match our emotions, try to map it to the closest one
            const emotionMapping = {
                'joy': 'happy',
                'excitement': 'happy',
                'pleasure': 'happy',
                'content': 'happy',
                'empathy': 'sad',
                'sorry': 'sad',
                'disappointment': 'sad',
                'frustration': 'angry',
                'annoyance': 'angry',
                'upset': 'angry',
                'shock': 'surprised',
                'amazement': 'surprised',
                'astonishment': 'surprised',
                'uncertainty': 'confused',
                'puzzled': 'confused',
                'questioning': 'confused',
                'romantic': 'love',
                'caring': 'love',
                'affection': 'love',
                'affectionate': 'love',
                'playful': 'cute',
                'shy': 'cute',
                'adorable': 'cute'
            };
            
            const mappedEmotion = emotionMapping[response];
            if (mappedEmotion) {
                console.log(`Mapped emotion "${response}" to "${mappedEmotion}"`);
                return mappedEmotion;
            }
            
            // Default to happy if no mapping found
            console.log(`No mapping found for "${response}", defaulting to "happy"`);
            return 'happy';
        }
    } catch (error) {
        console.error('Error analyzing message sentiment:', error);
        return getRandomExpression('happy'); // Default to happy on error
    }
}

/**
 * Gets a random expression from the specified emotion
 * @param {string} emotion - The emotion category
 * @returns {string} - A specific expression
 */
function getRandomExpression(emotion) {
    const expressions = EXPRESSIONS[emotion] || EXPRESSIONS.happy;
    return expressions[Math.floor(Math.random() * expressions.length)];
}

/**
 * Generates a sticker image based on character and sentiment
 * @param {string} characterImagePath - Path to character image
 * @param {string} emotion - The emotion to express
 * @param {string} message - The user's message
 * @param {string} aiResponse - The AI's text response
 * @returns {string} - Path to generated sticker image
 */
async function generateStickerImage(characterImagePath, emotion, message, aiResponse) {
    try {
        if (!fs.existsSync(characterImagePath)) {
            console.error('Character image not found:', characterImagePath);
            return null;
        }
        
        // Create output directory if it doesn't exist
        const outputDir = path.join(process.cwd(), 'generated_stickers');
        fs.ensureDirSync(outputDir);
        
        // Read the character image as base64
        const characterImageBuffer = fs.readFileSync(characterImagePath);
        const base64Image = characterImageBuffer.toString('base64');
        
        // Get a random expression for the emotion
        const expression = getRandomExpression(emotion);
        
        // Get a random style
        const style = STICKER_STYLES[Math.floor(Math.random() * STICKER_STYLES.length)];
        console.log(`Generating sticker with style: ${style}`);
        
        // Create a prompt for image generation
        const prompt = `
        Create a sticker image of the same person in the reference image, but with a ${expression} expression.
        The character should be ${emotion}.
        Make it in ${style}.
        Focus on the face and upper body, with exaggerated expressions.
        The character should look exactly like the reference image but with the new expression.
        IMPORTANT: Create a completely white color background with NO text or captions whatsoever.
        The image should ONLY contain the character with NO text elements.
        Create a clean, professional sticker with just the character.
        `;
        
        // Get a fresh API key for image generation
        const apiKey = apiKeyManager.getNextApiKey('gemini');
        if (!apiKey) {
            console.error('No valid Gemini API key available');
            return null;
        }
        
        // Create a new instance of the Gemini client
        const localGenAI = new GoogleGenerativeAI(apiKey);
        
        // Set up the model for image generation
        const model = localGenAI.getGenerativeModel({
            model: "gemini-2.0-flash-exp-image-generation",
            generationConfig: {
                responseModalities: ['Text', 'Image'],
                temperature: 0.2,
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
        
        // Prepare the content parts with both the image and prompt - FIXED FORMAT
        const contents = [
            { text: prompt },
            { 
                inlineData: { 
                    mimeType: "image/jpeg", 
                    data: base64Image 
                } 
            }
        ];
        
        // Generate the image
        const result = await model.generateContent(contents);
        const response = await result.response;
        
        // Extract the image from the response
        const imageData = response.candidates[0].content.parts.find(part => part.inlineData);
        
        if (!imageData) {
            console.error('No image data in response');
            return null;
        }
        
        // Save the image
        const timestamp = Date.now();
        const outputPath = path.join(outputDir, `sticker_${timestamp}.png`);
        
        // Decode and save the base64 image
        const stickerImageBuffer = Buffer.from(imageData.inlineData.data, 'base64');
        await fs.writeFile(outputPath, stickerImageBuffer);
        
        console.log(`Sticker image generated: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error('Error generating sticker image:', error);
        return null;
    }
}

/**
 * Creates a WhatsApp sticker from an image
 * @param {string} imagePath - Path to the image
 * @param {Object} userData - User data containing companion information
 * @returns {Buffer} - Sticker buffer
 */
async function createWhatsAppSticker(imagePath, userData) {
    try {
        // Process the image for optimal sticker format
        const processedImagePath = await processImageForSticker(imagePath);
        
        // Create the sticker
        const sticker = new Sticker(processedImagePath, {
            pack: `${userData.companionName}`,
            author: 'Hyper AI',
            type: StickerTypes.FULL,
            categories: ['🎭', '😊', '💬'],
            quality: 90
        });
        
        // Get the buffer
        const stickerBuffer = await sticker.toBuffer();
        
        // Clean up the processed image
        await fs.remove(processedImagePath);
        
        return stickerBuffer;
    } catch (error) {
        console.error('Error creating WhatsApp sticker:', error);
        return null;
    }
}

/**
 * Processes an image to make it suitable for a WhatsApp sticker
 * @param {string} imagePath - Path to the image
 * @returns {string} - Path to the processed image
 */
async function processImageForSticker(imagePath) {
    try {
        const outputDir = path.join(process.cwd(), 'temp');
        fs.ensureDirSync(outputDir);
        
        const outputPath = path.join(outputDir, `processed_${path.basename(imagePath)}`);
        
        // Simple resize only
        await sharp(imagePath)
            .resize(512, 512, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .toFormat('png')
            .toFile(outputPath);
        
        return outputPath;
    } catch (error) {
        console.error('Error processing image for sticker:', error);
        return imagePath; // Return original if processing fails
    }
}

module.exports = {
    shouldSendSticker,
    analyzeMessageSentiment,
    generateStickerImage,
    createWhatsAppSticker
};