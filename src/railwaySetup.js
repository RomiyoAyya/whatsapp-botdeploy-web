const storageUtils = require('./storageUtils');
const cron = require('node-cron');

// Function to initialize Railway-specific setup
async function setupRailway() {
    // Override console.log and console.error to sanitize sensitive information
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    
    // Function to sanitize logs
    const sanitizeLog = (args) => {
        return args.map(arg => {
            if (typeof arg === 'string') {
                // Sanitize API keys
                return arg.replace(/(sk-[a-zA-Z0-9-_]{30,})/g, 'sk-***-sanitized')
                          .replace(/(Bearer\s+[a-zA-Z0-9-_.]{30,})/g, 'Bearer sk-***-sanitized')
                          .replace(/(AIzaSy[a-zA-Z0-9-_]{30,})/g, 'AIzaSy***-sanitized');
            }
            return arg;
        });
    };
    
    // Override console.log
    console.log = function() {
        originalConsoleLog.apply(console, sanitizeLog(Array.from(arguments)));
    };
    
    // Override console.error
    console.error = function() {
        originalConsoleError.apply(console, sanitizeLog(Array.from(arguments)));
    };
    
    // Initialize storage
    await storageUtils.initialize();
    
    // Set up periodic backups every 30 minutes
    // This is just a placeholder now since we're not using Mega.nz
    cron.schedule('0 * * * *', async () => {
        console.log('Scheduled backup time - skipping since Mega.nz is not available');
    });
    
    // Set up error handling for uncaught exceptions
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception:', error.message);
        // Don't log the full stack trace as it might contain sensitive info
    });
    
    // Set up error handling for unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled promise rejection. Reason:', typeof reason === 'object' ? reason.message : reason);
    });
    
    console.log('Railway setup completed');
}

module.exports = setupRailway;