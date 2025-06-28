const path = require('path');
const fs = require('fs-extra'); // Ensure this is declared only once
const { Storage } = require('megajs');
const schedule = require('node-schedule');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Paths to backup
const USER_DATA_PATH = path.join(process.cwd(), 'user_data');
const CHARACTER_IMAGES_PATH = path.join(process.cwd(), 'character_images');
const AUTH_INFO_PATH = path.join(process.cwd(), 'auth_info_baileys');
const CONFIG_PATH = path.join(process.cwd(), 'config');

// Mega.nz credentials
const MEGA_EMAIL = process.env.MEGA_EMAIL;
const MEGA_PASSWORD = process.env.MEGA_PASSWORD;

// Backup job reference
let backupJob = null;

// Remove the duplicate fs and path declarations
// const fs = require('fs-extra');
// const path = require('path');
require('dotenv').config(); // Load environment variables

// Use environment variable for autobackup status
let autoBackupEnabled = process.env.AUTO_BACKUP_ENABLED === 'true';

// Function to update the .env file
function updateEnvVariable(key, value) {
    const envPath = path.join(process.cwd(), '.env');
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const updatedContent = envContent.replace(new RegExp(`${key}=.*`), `${key}=${value}`);
    fs.writeFileSync(envPath, updatedContent);
}

// Enable auto backup
async function enableAutoBackup() {
    autoBackupEnabled = true;
    updateEnvVariable('AUTO_BACKUP_ENABLED', 'true');
    
    // If there's no existing job, schedule it
    if (!backupJob) {
        scheduleBackups();
    }
    
    console.log('Auto backup enabled');
    return true;
}

// Disable auto backup
async function disableAutoBackup() {
    autoBackupEnabled = false;
    updateEnvVariable('AUTO_BACKUP_ENABLED', 'false');
    
    // Cancel the existing job if it exists
    if (backupJob) {
        backupJob.cancel();
        backupJob = null;
    }
    
    console.log('Auto backup disabled');
    return true;
}

// Get auto backup status
async function getAutoBackupStatus() {
    // Always read from environment to get the latest value
    return process.env.AUTO_BACKUP_ENABLED === 'true';
}

// Schedule backup every 15 minutes
function scheduleBackups() {
    // Check if autobackup is enabled directly from environment
    if (process.env.AUTO_BACKUP_ENABLED === 'true') {
        backupJob = schedule.scheduleJob('0 * * * *', async () => {
            console.log('Scheduled backup time - attempting backup to Mega.nz');
            if (process.env.AUTO_BACKUP_ENABLED === 'true') {
                try {
                    // Test Mega.nz connection before attempting backup
                    let storage = null;
                    try {
                        console.log('Testing Mega.nz connection...');
                        storage = await loginToMega(2, 1000); // Reduced retry count for quick check
                        console.log('Mega.nz connection successful, proceeding with backup');
                        storage.close();
                        
                        // Connection successful, proceed with backup
                        await performBackup(); // This function is defined later in the file
                    } catch (error) {
                        console.error('Mega.nz connection test failed:', error.message);
                        console.log('Scheduled backup time - skipping since Mega.nz is not available');
                        
                        // Try again in 5 minutes
                        setTimeout(async () => {
                            console.log('Attempting backup retry after connection failure...');
                            try {
                                await performBackup();
                                console.log('Delayed backup completed successfully');
                            } catch (retryError) {
                                console.error('Delayed backup attempt failed:', retryError.message);
                            }
                        }, 5 * 60 * 1000); // 5 minutes
                    } finally {
                        if (storage) {
                            try {
                                storage.close();
                            } catch (closeError) {
                                console.error('Error closing test connection:', closeError.message);
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error in scheduled backup:', error);
                }
            } else {
                console.log('Automatic backups are disabled, skipping scheduled backup');
            }
        });
        
        console.log('Backup scheduled to run every hour');
    } else {
        console.log('Automatic backups are disabled');
    }
}

// Run backup immediately
async function runBackupNow() {
    console.log('Manual backup requested');
    return await performBackup();
}

// Download a file from Mega
function downloadFile(file, localPath) {
    return new Promise((resolve, reject) => {
        try {
            const fileName = file.name;
            console.log(`Downloading ${fileName} to ${localPath}...`);
            
            // Create directory if it doesn't exist
            const directory = path.dirname(localPath);
            fs.ensureDirSync(directory);
            
            // Create write stream for the file
            const writeStream = fs.createWriteStream(localPath);
            
            // Get download stream from Mega
            const downloadStream = file.download();
            
            // Pipe the download to the file
            downloadStream.pipe(writeStream);
            
            // Handle completion
            writeStream.on('finish', () => {
                console.log(`Successfully downloaded ${fileName}`);
                resolve();
            });
            
            // Handle errors
            writeStream.on('error', (err) => {
                console.error(`Error writing ${fileName}:`, err);
                reject(err);
            });
            
            downloadStream.on('error', (err) => {
                console.error(`Error downloading ${fileName}:`, err);
                reject(err);
            });
        } catch (err) {
            console.error(`Error preparing download for file:`, err);
            reject(err);
        }
    });
}

// Main restore function
async function performRestore() {
    console.log('Starting restoration from Mega.nz...');
    let storage = null;
    
    try {
        // Login to Mega
        console.log('Logging in to Mega.nz...');
        storage = await loginToMega();
        console.log('Successfully logged in to Mega.nz');
        
        // Get root folder
        const root = storage.root;
        
        // Find WhatsappAIBackup folder
        const backupFolder = root.children.find(node => node.name === 'WhatsappAIBackup');
        if (!backupFolder) {
            console.error('Backup folder not found on Mega.nz');
            return false;
        }
        
        // Restore directories
        const directories = [
            { path: USER_DATA_PATH, name: 'user_data' },
            { path: CHARACTER_IMAGES_PATH, name: 'character_images' },
            { path: AUTH_INFO_PATH, name: 'auth_info_baileys' },
            { path: CONFIG_PATH, name: 'config' }
        ];
        
        for (const dir of directories) {
            console.log(`Restoring ${dir.name}...`);
            
            // Find directory folder in backup
            const dirFolder = backupFolder.children.find(node => node.name === dir.name);
            if (!dirFolder) {
                console.log(`Directory ${dir.name} not found in backup, skipping`);
                continue;
            }
            
            // Ensure local directory exists
            fs.ensureDirSync(dir.path);
            
            // Clear existing files
            fs.emptyDirSync(dir.path);
            
            // Download files
            for (const file of dirFolder.children) {
                if (!file.directory) {
                    const localFilePath = path.join(dir.path, file.name);
                    await downloadFile(file, localFilePath);
                }
            }
            
            console.log(`${dir.name} restoration completed`);
        }
        
        console.log('Restoration from Mega.nz completed successfully');
        return true;
    } catch (error) {
        console.error('Restoration from Mega.nz failed:', error.message);
        return false;
    } finally {
        if (storage) {
            storage.close();
        }
    }
}

// Run restore immediately
async function runRestoreNow() {
    console.log('Manual restoration requested');
    return await performRestore();
}

// Enable auto backup
async function enableAutoBackup() {
    autoBackupEnabled = true;
    updateEnvVariable('AUTO_BACKUP_ENABLED', 'true');
    
    // If there's no existing job, schedule it
    if (!backupJob) {
        scheduleBackups();
    }
    
    console.log('Auto backup enabled');
    return true;
}

// Disable auto backup
async function disableAutoBackup() {
    autoBackupEnabled = false;
    updateEnvVariable('AUTO_BACKUP_ENABLED', 'false');
    
    // Cancel the existing job if it exists
    if (backupJob) {
        backupJob.cancel();
        backupJob = null;
    }
    
    console.log('Auto backup disabled');
    return true;
}

// Get auto backup status
async function getAutoBackupStatus() {
    return autoBackupEnabled;
}

// Add this function before the module.exports

// Add a function to perform startup restoration
async function performStartupRestore() {
    console.log('Performing startup restoration from Mega.nz...');
    
    try {
        // Check if auth_info_baileys directory exists and has content
        const authDir = path.join(process.cwd(), 'auth_info_baileys');
        const userDataDir = path.join(process.cwd(), 'user_data');
        const characterImagesDir = path.join(process.cwd(), 'character_images');
        const configDir = path.join(process.cwd(), 'config');
        
        // Check if we need to restore session data
        let needsSessionRestore = true;
        if (fs.existsSync(authDir)) {
            const files = fs.readdirSync(authDir);
            if (files.length > 0) {
                console.log('Existing session data found, checking if it needs to be replaced...');
                
                // Check the age of the session files
                const stats = fs.statSync(path.join(authDir, files[0]));
                const fileAge = Date.now() - stats.mtimeMs;
                const oneDayMs = 24 * 60 * 60 * 1000;
                
                if (fileAge < oneDayMs) {
                    console.log('Session data is recent (less than 24 hours old), skipping session restore');
                    needsSessionRestore = false;
                } else {
                    console.log('Session data is old, will restore it');
                }
            }
        }
        
        // Always restore user data, character images, and config
        console.log('Will restore user data, character images, and config regardless of age');
        
        // Set a timeout for the entire restore operation
        const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Restoration timed out after 120 seconds')), 120000);
        });
        
        // Attempt to restore data with timeout
        try {
            // Create a custom restore function that only restores what we need
            const restorePromise = customRestoreOnStartup(needsSessionRestore);
            const success = await Promise.race([restorePromise, timeoutPromise]);
            
            if (success) {
                console.log('Startup restoration completed successfully');
                return true;
            } else {
                console.log('Startup restoration failed or no backup found');
                return false;
            }
        } catch (timeoutError) {
            console.error('Restoration timed out:', timeoutError.message);
            console.log('Proceeding with local data due to timeout');
            return false;
        }
    } catch (error) {
        console.error('Error during startup restoration:', error);
        return false;
    }
}

// Add a new function to perform selective restoration on startup
async function customRestoreOnStartup(includeSessionData) {
    console.log('Starting selective restoration from Mega.nz...');
    let storage = null;
    
    try {
        // Login to Mega
        console.log('Logging in to Mega.nz...');
        storage = await loginToMega();
        console.log('Successfully logged in to Mega.nz');
        
        // Get root folder
        const root = storage.root;
        
        // Find WhatsappAIBackup folder
        const backupFolder = root.children.find(node => node.name === 'WhatsappAIBackup');
        if (!backupFolder) {
            console.error('Backup folder not found on Mega.nz');
            return false;
        }
        
        // Define which directories to restore
        const directories = [];
        
        // Always include these directories
        directories.push(
            { path: USER_DATA_PATH, name: 'user_data' },
            { path: CHARACTER_IMAGES_PATH, name: 'character_images' },
            { path: CONFIG_PATH, name: 'config' }
        );
        
        // Conditionally include session data
        if (includeSessionData) {
            directories.push({ path: AUTH_INFO_PATH, name: 'auth_info_baileys' });
        }
        
        for (const dir of directories) {
            console.log(`Restoring ${dir.name}...`);
            
            // Find directory folder in backup
            const dirFolder = backupFolder.children.find(node => node.name === dir.name);
            if (!dirFolder) {
                console.log(`Directory ${dir.name} not found in backup, skipping`);
                continue;
            }
            
            // Ensure local directory exists
            fs.ensureDirSync(dir.path);
            
            // For user data, character images, and config, clear existing files
            if (dir.name !== 'auth_info_baileys' || includeSessionData) {
                console.log(`Clearing existing files in ${dir.name}...`);
                fs.emptyDirSync(dir.path);
            }
            
            // Download files
            for (const file of dirFolder.children) {
                if (!file.directory) {
                    const localFilePath = path.join(dir.path, file.name);
                    await downloadFile(file, localFilePath);
                }
            }
            
            console.log(`${dir.name} restoration completed`);
        }
        
        console.log('Selective restoration from Mega.nz completed successfully');
        return true;
    } catch (error) {
        console.error('Selective restoration from Mega.nz failed:', error.message);
        return false;
    } finally {
        if (storage) {
            try {
                storage.close();
            } catch (closeError) {
                console.error('Error closing Mega.nz connection:', closeError.message);
            }
        }
    }
}

// Create a promise-based Mega login function
// Login to Mega with retry logic
function loginToMega(retryCount = 3, delay = 2000) {
  return new Promise(async (resolve, reject) => {
    let attempts = 0;
    
    const attemptLogin = async () => {
      attempts++;
      try {
        if (!MEGA_EMAIL || !MEGA_PASSWORD) {
          return reject(new Error('Mega.nz credentials not found in environment variables'));
        }

        console.log(`Login attempt ${attempts}/${retryCount}...`);
        
        const storage = new Storage({
          email: MEGA_EMAIL,
          password: MEGA_PASSWORD,
        });

        const readyHandler = () => {
          storage.removeListener('error', errorHandler);
          console.log('Mega.nz login successful');
          resolve(storage);
        };

        const errorHandler = (err) => {
          storage.removeListener('ready', readyHandler);
          console.error(`Mega.nz login error (attempt ${attempts}/${retryCount}):`, err.message);
          
          if (attempts < retryCount) {
            console.log(`Retrying in ${delay/1000} seconds...`);
            setTimeout(attemptLogin, delay);
          } else {
            reject(new Error(`Failed to login to Mega.nz after ${retryCount} attempts: ${err.message}`));
          }
        };

        storage.once('ready', readyHandler);
        storage.once('error', errorHandler);
      } catch (err) {
        console.error(`Exception during login attempt ${attempts}/${retryCount}:`, err.message);
        
        if (attempts < retryCount) {
          console.log(`Retrying in ${delay/1000} seconds...`);
          setTimeout(attemptLogin, delay);
        } else {
          reject(new Error(`Failed to login to Mega.nz after ${retryCount} attempts: ${err.message}`));
        }
      }
    };
    
    // Start the first attempt
    attemptLogin();
  });
}

// Add this function to initialize the backup schedule on bot startup
function initializeBackupOnStartup() {
    console.log('Initializing backup system...');
    
    // Check if autobackup is enabled from environment
    if (process.env.AUTO_BACKUP_ENABLED === 'true') {
        console.log('Auto backup is enabled in .env, starting backup schedule');
        scheduleBackups();
    } else {
        console.log('Auto backup is disabled in .env, not starting backup schedule');
    }
}


// Create a folder in Mega
function createFolder(parentFolder, folderName) {
    return new Promise((resolve, reject) => {
        parentFolder.mkdir(folderName, (err, folder) => {
            if (err) {
                reject(err);
            } else {
                resolve(folder);
            }
        });
    });
}

// Delete a file or folder in Mega
function deleteItem(item) {
    return new Promise((resolve, reject) => {
        item.delete((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Main backup function with improved error handling
async function performBackup() {
  console.log('Starting backup to Mega.nz...');
  let storage = null;
  
  try {
    // Login to Mega with retry logic
    console.log('Logging in to Mega.nz...');
    storage = await loginToMega();
    console.log('Successfully logged in to Mega.nz');
    
    // Get root folder
    const root = storage.root;
    
    // Find or create WhatsappAIBackup folder
    let backupFolder = root.children.find(node => node.name === 'WhatsappAIBackup');
    if (!backupFolder) {
        console.log('Creating WhatsappAIBackup folder...');
        backupFolder = await createFolder(root, 'WhatsappAIBackup');
    } else {
        // Clean up the entire backup folder first
        console.log('Cleaning up existing backup folder...');
        for (const child of [...backupFolder.children]) {
            await deleteItem(child);
        }
    }
    
    // Backup directories
    const directories = [
        { path: USER_DATA_PATH, name: 'user_data' },
        { path: CHARACTER_IMAGES_PATH, name: 'character_images' },
        { path: AUTH_INFO_PATH, name: 'auth_info_baileys' },
        { path: CONFIG_PATH, name: 'config' }
    ];
    
    for (const dir of directories) {
        if (!fs.existsSync(dir.path)) {
            console.log(`Directory ${dir.path} does not exist, creating it`);
            fs.ensureDirSync(dir.path);
        }
        
        console.log(`Backing up ${dir.name}...`);
        
        // Create new folder for this directory
        const dirFolder = await createFolder(backupFolder, dir.name);
        
        // Upload files
        const files = fs.readdirSync(dir.path);
        if (files.length === 0) {
            console.log(`No files found in ${dir.path}, creating a placeholder file`);
            const placeholderPath = path.join(dir.path, '.placeholder');
            fs.writeFileSync(placeholderPath, 'This is a placeholder file to ensure the directory is backed up.');
            await uploadFile(dirFolder, placeholderPath);
            fs.unlinkSync(placeholderPath);
        } else {
            for (const file of files) {
                const filePath = path.join(dir.path, file);
                if (fs.statSync(filePath).isFile()) {
                    console.log(`Uploading ${file}...`);
                    await uploadFile(dirFolder, filePath);
                }
            }
        }
        
        console.log(`${dir.name} backup completed`);
    }
    
    console.log('Backup to Mega.nz completed successfully');
    return true;
  } catch (error) {
    console.error('Backup to Mega.nz failed:', error.message);
    return false;
  } finally {
    if (storage) {
      try {
        storage.close();
      } catch (closeError) {
        console.error('Error closing Mega.nz connection:', closeError.message);
      }
    }
  }
}

// Update the module.exports to include performBackup
module.exports = {
    scheduleBackups,
    runBackupNow,
    runRestoreNow,
    performRestore,
    enableAutoBackup,
    disableAutoBackup,
    getAutoBackupStatus,
    performStartupRestore,
    customRestoreOnStartup,
    loginToMega,
    initializeBackupOnStartup,
    performBackup
};

// Create a folder in Mega
function createFolder(parentFolder, folderName) {
    return new Promise((resolve, reject) => {
        parentFolder.mkdir(folderName, (err, folder) => {
            if (err) {
                reject(err);
            } else {
                resolve(folder);
            }
        });
    });
}

// Delete a file or folder in Mega
function deleteItem(item) {
    return new Promise((resolve, reject) => {
        item.delete((err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

// Upload a file to Mega
function uploadFile(folder, filePath) {
    return new Promise((resolve, reject) => {
        try {
            const fileName = path.basename(filePath);
            
            // Check if file exists and has content
            const stats = fs.statSync(filePath);
            if (stats.size === 0) {
                console.log(`Skipping empty file: ${fileName}`);
                resolve();
                return;
            }
            
            console.log(`Starting upload of ${fileName} (${filePath})`);
            
            // Create a readable stream from the file
            const fileStream = fs.createReadStream(filePath);
            
            // Upload the file
            folder.upload({
                name: fileName,
                size: stats.size
            }, fileStream, (err, file) => {
                if (err) {
                    console.error(`Error uploading ${fileName}:`, err);
                    reject(err);
                } else {
                    console.log(`Successfully uploaded ${fileName}`);
                    resolve(file);
                }
            });
        } catch (err) {
            console.error(`Error preparing upload for file:`, err);
            reject(err);
        }
    });
}
