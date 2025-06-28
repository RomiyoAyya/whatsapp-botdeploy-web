// ... existing code ...

// In the function that handles the restore command
async function handleRestoreCommand(message, client) {
    try {
        const backupUtils = require('../utils/backuputils');
        
        // Send initial message
        await client.sendMessage(message.from, { text: 'Starting restoration process...' });
        console.log(`Sent initial restore message to ${message.from}`);
        
        // Perform the restore
        const success = await backupUtils.runRestoreNow();
        
        // Send result message to admin with more detailed logging
        if (success) {
            console.log(`Sending restore success message to admin at ${message.from}`);
            try {
                const sentMsg = await client.sendMessage(message.from, { 
                    text: '✅ Restoration completed successfully! All data has been restored from backup.' 
                });
                console.log(`Success message sent with ID: ${sentMsg?.key?.id || 'unknown'}`);
            } catch (sendError) {
                console.error('Error sending success message:', sendError);
                // Try an alternative method to send the message
                await client.sendMessage(message.from, { 
                    text: '✅ Restore operation completed.' 
                });
            }
        } else {
            console.log(`Sending restore failure message to admin at ${message.from}`);
            await client.sendMessage(message.from, { 
                text: '❌ Restoration failed. Please check the logs for more information.' 
            });
        }
        
        return true;
    } catch (error) {
        console.error('Error in restore command:', error);
        await client.sendMessage(message.from, { 
            text: `❌ Error during restoration: ${error.message}` 
        });
        return false;
    }
}

// ... existing code ...