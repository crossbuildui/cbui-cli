import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import * as emoji from 'node-emoji';
import { exec } from 'child_process';
import util from 'util';
import inquirer from 'inquirer';
import ora from 'ora';

const execAsync = util.promisify(exec);

// Helper function to slugify strings for 'slug', 'scheme', and package names
function slugify(str) {
    return str
        .toLowerCase()
        .replace(/\s+/g, '-') // Replace spaces with -
        .replace(/[^\w-]+/g, '') // Remove all non-word chars (alphanumeric, underscore, hyphen)
        .replace(/--+/g, '-'); // Replace multiple - with single -
}

async function downloadGitTemplate(templateGitPath, destination, templateDisplayName) {
    const spinner = ora(`Downloading template '${templateDisplayName}'...`).start();
    try {
        // Using npx degit to avoid global install dependency for users
        // Format: npx degit user/repo/subdir#branch destination
        // Example: npx degit crossbuildui/crossbuildui/templates/default#main my-expo-app
        await execAsync(`npx degit ${templateGitPath} "${destination}" --force`);
        spinner.succeed(`Template '${templateDisplayName}' downloaded successfully to ${chalk.cyan(destination)}`);
    } catch (error) {
        spinner.fail(`Failed to download template '${templateDisplayName}'.`);
        let errorMessage = error.message;
        if (error.stderr) {
            // Degit often puts useful error messages in stderr
            errorMessage += `\n${error.stderr}`;
        }
        console.error(chalk.red(`Error details: ${errorMessage}`));
        throw new Error(`Failed to download template '${templateDisplayName}'.`);
    }
}

export async function initProject(rawProjectName, cliTemplateName) {
    const projectBaseName = rawProjectName.split('@')[0]; // e.g., "my-app" for prompts and internal names
    const projectDirName = projectBaseName; // Use the base name for the directory
    const projectDirectory = path.resolve(process.cwd(), projectDirName);

    if (await fs.pathExists(projectDirectory)) {
        const { overwrite } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: `${emoji.get('warning')} Directory '${projectDirName}' already exists. Overwrite? (This will delete the existing directory)`,
                default: false,
            },
        ]);
        if (overwrite) {
            const removeSpinner = ora(`Removing existing directory '${projectDirName}'...`).start();
            await fs.remove(projectDirectory);
            removeSpinner.succeed(`Removed existing directory '${projectDirName}'.`);
        } else {
            console.log(chalk.yellow('Project initialization aborted. Please choose a different name or remove the existing directory.'));
            process.exit(0);
            return;
        }
    }

    let templateToDownload = cliTemplateName || 'default';
    let finalTemplateUsed = templateToDownload;
    const githubRepoBase = 'crossbuildui/crossbuildui/templates'; // Assuming templates are in 'templates' dir at root of 'crossbuildui/crossbuildui'

    try {
        console.log(chalk.blue(`\n${emoji.get('male-factory-worker')} Initializing new CrossBuild UI project: ${chalk.bold(projectDirName)}`));
        await fs.ensureDir(projectDirectory); // Ensure directory exists (degit also creates it but good to be explicit)

        let templateDownloaded = false;
        try {
            const templateGitPath = `${githubRepoBase}/${templateToDownload}#main`; // Assuming #main branch
            await downloadGitTemplate(templateGitPath, projectDirectory, templateToDownload);
            templateDownloaded = true;
        } catch (downloadError) {
            if (cliTemplateName && cliTemplateName.toLowerCase() !== 'default') {
                console.warn(chalk.yellow(`${emoji.get('warning')} Template '${cliTemplateName}' not found or failed to download.`));
                const { proceedWithDefault } = await inquirer.prompt([
                    {
                        type: 'confirm',
                        name: 'proceedWithDefault',
                        message: `Do you want to try initializing with the 'default' template instead?`,
                        default: true,
                    },
                ]);
                if (proceedWithDefault) {
                    templateToDownload = 'default';
                    finalTemplateUsed = 'default';
                    const defaultTemplateGitPath = `${githubRepoBase}/default#main`;
                    await downloadGitTemplate(defaultTemplateGitPath, projectDirectory, 'default');
                    templateDownloaded = true;
                } else {
                    console.log(chalk.yellow('Project initialization aborted by user.'));
                    if (await fs.pathExists(projectDirectory)) await fs.remove(projectDirectory);
                    process.exit(0);
                    return;
                }
            } else {
                // Failed to download 'default' or no specific template was requested and default failed
                throw downloadError; // Re-throw to be caught by the main catch block
            }
        }

        if (!templateDownloaded) {
            // This state should ideally not be reached if logic above is correct
            throw new Error('Template download failed and fallback was not successful.');
        }

        // Modify package.json
        const packageJsonPath = path.join(projectDirectory, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
            const packageJson = await fs.readJson(packageJsonPath);
            packageJson.name = slugify(projectBaseName); // package.json name is typically slugified
            await fs.writeJson(packageJsonPath, packageJson, { spaces: 2 });
            console.log(chalk.green(`${emoji.get('wrench')} Updated project name in package.json to '${packageJson.name}'.`));
        } else {
            console.warn(chalk.yellow(`${emoji.get('open_file_folder')} package.json not found in the template. Skipping modification.`));
        }

        // Modify app.json
        const appJsonPath = path.join(projectDirectory, 'app.json');
        if (await fs.pathExists(appJsonPath)) {
            let appJson = await fs.readJson(appJsonPath);
            if (!appJson.expo) appJson.expo = {}; // Ensure expo object exists

            const appDetails = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'appName',
                    message: 'Enter the display name for your app:',
                    default: appJson.expo.name && appJson.expo.name !== 'default' ? appJson.expo.name : projectBaseName,
                },
                {
                    type: 'input',
                    name: 'appSlug',
                    message: 'Enter the slug for your app (e.g., for URLs):',
                    default: appJson.expo.slug && appJson.expo.slug !== 'default' ? appJson.expo.slug : slugify(projectBaseName),
                    validate: input => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input) ? true : 'Slug must be lowercase, alphanumeric, and can contain hyphens (e.g., my-app-slug).',
                },
                {
                    type: 'input',
                    name: 'appScheme',
                    message: 'Enter the URL scheme for your app (e.g., for deep linking):',
                    default: appJson.expo.scheme && appJson.expo.scheme !== 'default' ? appJson.expo.scheme : slugify(projectBaseName).replace(/-/g, ''),
                    validate: input => /^[a-zA-Z][a-zA-Z0-9+.-]*$/.test(input) ? true : 'Scheme must start with a letter and can contain letters, digits, plus (+), period (.), or hyphen (-).',
                }
            ]);

            appJson.expo.name = appDetails.appName;
            appJson.expo.slug = appDetails.appSlug;
            appJson.expo.scheme = appDetails.appScheme;

            await fs.writeJson(appJsonPath, appJson, { spaces: 2 });
            console.log(chalk.green(`${emoji.get('wrench')} Updated app details in app.json.`));
        } else {
            console.warn(chalk.yellow(`${emoji.get('open_file_folder')} app.json not found in the template. Skipping modification.`));
        }

        console.log(chalk.greenBright(`\n${emoji.get('tada')} Project '${chalk.bold(projectDirName)}' initialized successfully with the '${finalTemplateUsed}' template!`));
        console.log('\nTo get started:');
        console.log(chalk.cyan(`  cd ${projectDirName}`));
        console.log(chalk.cyan(`  npm install`) + chalk.gray(' (or yarn install / pnpm install)'));

        if (finalTemplateUsed.toLowerCase() !== 'default') {
            console.log(chalk.cyan(`  cbui-cli login`) + chalk.gray(' (if not already authenticated)'));
            console.log(chalk.cyan(`  cbui-cli install`) + chalk.gray(' (to install CrossBuild UI components if defined in the template)'));
        }
        console.log(chalk.cyan('  npx expo start') + chalk.gray(' (to launch your app)'));
        console.log(`\n${emoji.get('rocket')} Happy building!`);
        process.exit(0);

    } catch (error) {
        console.error(chalk.red(`\n${emoji.get('boom')} An error occurred during project initialization: ${error.message}`));
        if (await fs.pathExists(projectDirectory)) {
            const { confirmCleanup } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirmCleanup',
                    message: `An error occurred. Do you want to remove the partially created directory '${projectDirName}'?`,
                    default: true,
                },
            ]);
            if (confirmCleanup) {
                const cleanupSpinner = ora(`Cleaning up directory '${projectDirName}'...`).start();
                await fs.remove(projectDirectory);
                cleanupSpinner.succeed(`Cleaned up directory: ${projectDirName}`);
            }
        }
        process.exit(1);
    }
}
