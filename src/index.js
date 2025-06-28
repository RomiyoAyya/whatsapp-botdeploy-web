// ... existing code ...

// Add this near the top of your file with other imports
const backupUtils = require('./utils/backupUtils');

// Make sure port is configured for both local and Railway
const PORT = process.env.PORT || 3000;

// Ensure paths use process.cwd() for cross-platform compatibility
const AUTH_PATH = path.join(process.cwd(), 'auth_info_baileys');
const USER_DATA_PATH = path.join(process.cwd(), 'user_data');

// Import the utils module
const utils = require('./utils');

// Import the backup utilities
const backupUtils = require('./utils/backupUtils');

// Import the API key manager
const apiKeyManager = require('./utils/apiKeyManager');

// In your message handler function
async function handleMessage(message) {
    // Get the user ID from the message
    const userId = message.from;
    const messageText = message.body.trim();
    
    console.log(`Received message: "${messageText}" from ${userId}`);
    
    // Check if the message contains image generation keywords
    if (messageText.toLowerCase().includes('send me') || 
        messageText.toLowerCase().includes('show me') || 
        messageText.toLowerCase().includes('generate') || 
        messageText.toLowerCase().includes('create') || 
        messageText.toLowerCase().includes('make') ||
        messageText.toLowerCase().includes('photo')) {
        
        await client.sendMessage(
            message.from,
            { text: 'Wait a minute, let me take a photo for you... 📸' }
        );
        
        try {
            const imagePath = await utils.generateImage(userId, messageText);
            
            if (imagePath) {
                console.log(`Successfully generated image at: ${imagePath}`);
                // Send the generated image back to the user
                await client.sendMessage(
                    message.from,
                    {
                        image: { url: imagePath },
                        caption: 'I took this photo for you, I think you will like it! 💖'
                    }
                );
            } else {
                console.error('Image generation returned null');
                // Send an error message
                await client.sendMessage(
                    message.from,
                    { text: "Oh, I'm so embarrassed! 🙈 I couldn't take that photo right now. Let's try something else together later! 💫" }
                );
            }
        } catch (error) {
            console.error('Error generating image:', error);
            await client.sendMessage(
                message.from,
                { text: "Oh, I'm so embarrassed! 🙈 I couldn't take that photo right now. Let's try something else together later! 💫" }
                );
            }
    } else {
        // Handle regular messages
        // ...
    }
}

// For Railway, make sure the server is listening on the correct port
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Schedule backups to run every 15 minutes
  backupUtils.scheduleBackups();
  
  // Run an initial backup
  backupUtils.runBackupNow().then(success => {
    if (success) {
      console.log('Initial backup completed successfully');
    } else {
      console.warn('Initial backup failed, will retry at next scheduled time');
    }
  });
});

// Add this to your initialization function before starting the bot
async function initializeServices() {
    try {
        console.log('Initializing services...');
        
        // Attempt to restore from Mega.nz backup
        console.log('Attempting to restore from latest Mega.nz backup...');
        const restoreSuccess = await backupUtils.performRestore();
        
        if (restoreSuccess) {
            console.log('Successfully restored from Mega.nz backup');
        } else {
            console.warn('Failed to restore from Mega.nz backup, using local files');
        }
        
        // Initialize other services
        // ... other initialization code ...
        
        console.log('All services initialized successfully');
    } catch (error) {
        console.error('Error initializing services:', error);
    }
}

// In your app.listen or main function, call initializeServices before starting the bot
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize all services first
    await initializeServices();
    
    // Schedule backups to run every 15 minutes
    backupUtils.scheduleBackups();
});

// Initialize services
async function initializeServices() {
    try {
        // Initialize storage
        await storageUtils.initialize();
        
        // Initialize API key manager
        await apiKeyManager.initialize();
        
        console.log('All services initialized successfully');
    } catch (error) {
        console.error('Error initializing services:', error);
    }
}

// Start the server - FIXED: removed duplicate app.listen call
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize all services
    await initializeServices();
    
    // Schedule backups to run every 15 minutes
    backupUtils.scheduleBackups();
    
    // Run an initial backup
    backupUtils.runBackupNow().then(success => {
        if (success) {
            console.log('Initial backup completed successfully');
        } else {
            console.warn('Initial backup failed, will retry at next scheduled time');
        }
    });
});