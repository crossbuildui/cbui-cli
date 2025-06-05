import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import http from 'http';
import open from 'open';
import chalk from 'chalk';
import * as emoji from 'node-emoji';
import ora from 'ora';

const CREDENTIALS_DIR = path.join(os.homedir(), '.cbui-cli');
const TOKEN_FILE = path.join(CREDENTIALS_DIR, 'token.json');
const CLI_LOCAL_PORT = 38080; // Port for the CLI's local callback server
const NEXTJS_AUTH_URL = 'http://localhost:3000/cli-auth-login';

/**
 * Saves the authentication token.
 * @param {string} token The authentication token (e.g., Firebase ID Token).
 */
async function saveToken(token) {
    const spinner = ora('Saving authentication token...').start();
    try {
        await fs.ensureDir(CREDENTIALS_DIR);
        await fs.writeJson(TOKEN_FILE, { token });
        spinner.succeed(chalk.green(`${emoji.get('sparkles')} Authentication token saved successfully!`));
        // The message "Authentication successful! Press Ctrl+C to exit." is specific to the server context.
    } catch (error) {
        spinner.fail(chalk.red(`${emoji.get('x')} Error saving token: ${error.message}`));
        process.exit(1);
    }
}

/**
 * Initiates the login flow by opening the browser and starting a local server for the callback.
 * @returns {Promise<void>}
 */
export async function initiateLoginFlow() {
    if (await isAuthenticated()) {
        console.log(chalk.green(`${emoji.get('white_check_mark')} You're already logged in.`));
        return Promise.resolve();
    }

    return new Promise(async (resolve, reject) => {
        let serverSpinner;
        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (url.pathname === '/cli-auth-callback') {
                const token = url.searchParams.get('token');
                if (token) {
                    await saveToken(token);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<h1>Authentication Successful!</h1><p>You can close this browser tab and return to the CLI.</p><script>setTimeout(() => window.close(), 1000);</script>');
                    server.close(() => {
                        if (serverSpinner) serverSpinner.succeed(chalk.green(`${emoji.get('lock')} Login successful! CLI authentication complete.`));
                        else console.log(chalk.green(`${emoji.get('lock')} Login successful! CLI authentication complete.`));
                        resolve(); // Resolve the promise on success
                    });
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end('<h1>Authentication Failed</h1><p>No token received. Please try again.</p>');
                    server.close(() => {
                        if (serverSpinner) serverSpinner.fail(chalk.red(`${emoji.get('warning')} Login failed: No token received in callback.`));
                        else console.error(chalk.red(`${emoji.get('warning')} Login failed: No token received in callback. Please try again.`));
                        reject(new Error('No token received in callback.')); // Reject the promise on failure
                    });
                }
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        
        serverSpinner = ora('Starting local server for authentication callback...').start();
        server.listen(CLI_LOCAL_PORT, async () => {
            serverSpinner.succeed('Local authentication server started.');
            const authUrl = `${NEXTJS_AUTH_URL}?cli_callback_port=${CLI_LOCAL_PORT}`;
            console.log(chalk.yellow(`\n${emoji.get('globe_with_meridians')} Please login via your browser. Opening: ${chalk.bold(authUrl)}`));
            console.log(chalk.yellow(`${emoji.get('point_right')} If the browser doesn't open, please navigate to the URL above manually.`));
            
            const browserSpinner = ora('Attempting to open browser...').start();
            try {
                await open(authUrl);
                browserSpinner.succeed('Browser open attempt initiated.');
            } catch (error) {
                browserSpinner.fail(chalk.red(`${emoji.get('no_entry_sign')} Failed to open browser automatically.`));
                console.error(chalk.red(`${emoji.get('exclamation')} Please open this URL manually in your browser: ${chalk.bold(authUrl)}`));
                // Don't reject here, let the user try manually. The server is still running.
            }
        });

        server.on('error', (err) => {
            if (serverSpinner) serverSpinner.fail(chalk.red(`${emoji.get('fire')} Local server error: ${err.message}`));
            else console.error(chalk.red(`${emoji.get('fire')} Local server error: ${err.message}`));
            reject(err); // Reject the promise on server error
        });
    });
}

/**
 * Retrieves the stored authentication token.
 * @returns {Promise<string | null>} The token, or null if not found.
 */
export async function getToken() {
    // No spinner here as it's a quick, silent check often
    try {
        if (await fs.pathExists(TOKEN_FILE)) {
            const { token } = await fs.readJson(TOKEN_FILE);
            return token || null;
        }
        return null;
    } catch (error) {
        // Avoid noisy errors for a simple check, could be logged if verbose mode is added
        // console.error(chalk.red(`${emoji.get('lock_with_key')} Error reading token: ${error.message}`));
        return null;
    }
}

/**
 * Checks if the user is authenticated.
 * This is usually a quick check, so a spinner might be too verbose.
 * @returns {Promise<boolean>}
 */
export async function isAuthenticated() {
    const token = await getToken();
    return !!token;
}
/**
 * Clears the stored authentication token.
 */
export async function logoutUser() {
    const spinner = ora('Logging out...').start();
    try {
        await fs.remove(TOKEN_FILE);
        spinner.succeed(chalk.green(`${emoji.get('wave')} Logout successful! Token cleared. See you next time.`));
    } catch (error) {
        spinner.fail(chalk.red(`${emoji.get('bust_in_silhouette')} Error clearing token: ${error.message}`));
    }
}