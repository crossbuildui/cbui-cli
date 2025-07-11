#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { rainbow } from 'gradient-string';
import fs from 'fs-extra';
import path from 'path';
import { initiateLoginFlow, logoutUser, getToken, isAuthenticated } from '../lib/auth.js';
import { downloadPackage } from '../lib/downloader.js';
import { initProject } from '../lib/initProject.js';
import * as emoji from 'node-emoji';

const program = new Command();

function displayBanner() {
    const banner = "✨ Crossbuild UI CLI - Build Mobile Apps Faster. Way Faster.\n"
    console.log(rainbow(banner));
}

const customHelpContent = `🚀 Usage: cbui-cli [options] [command]

🎨 Crossbuild UI CLI helps you create Expo apps and download amazing UI components.

Options:
  -V, --version             ${emoji.get('package')} Output the current version number
  -h, --help                ${emoji.get('question')} Display this awesome help manual

Commands:
  init <projectName>        ${emoji.get('package')} Initialize a new Expo project with Crossbuild UI setup.
  login                     ${emoji.get('key')} Authenticate via your crossbuildui account in the browser
  logout                    ${emoji.get('door')} Clear stored credentials
  install [packageNames...] ${emoji.get('gear')} Install components. If no names, installs from package.json (latest versions)
  status                    ${emoji.get('mag')} Check current authentication status
  update [packageNames...]  ${emoji.get('rocket')} Update components to their latest versions. Use --all to update all from package.json.
  help [command]            ${emoji.get('bulb')} Display help for a specific command

Want to supercharge your app development? Check out our docs!
👉 https://crossbuilui.com/docs/getting-started/installation
`;

displayBanner();

program
    .name('cbui-cli')
    .description('Crossbuild UI CLI to create expo app and download ui components.')
    .version('2.5.1');

program.helpInformation = function () {
    return customHelpContent;
};

program
    .command('login')
    .description(`${emoji.get('key')} Authenticate via your crossbuildui account in the browser`)
    .action(async () => {
        try {
            await initiateLoginFlow();
            process.exit(0);
        } catch (error) {
            process.exit(1);
        }
    });

program
    .command('logout')
    .description(`${emoji.get('door')} Clear stored credentials`)
    .action(async () => {
        await logoutUser();
    });

program
    .command('install [packageNames...]')
    .description(`${emoji.get('gear')} Install components. If no names, installs/updates components listed in package.json to their latest versions.`)
    .action(async (packageNames) => {
        if (!(await isAuthenticated())) {
            console.error(chalk.red(`${emoji.get('no_entry_sign')} Authentication required. Please run ${chalk.bold('cbui-cli login')} first.`));
            process.exit(1);
        }
        const token = await getToken();
        if (!token) {
            // This case should ideally be caught by isAuthenticated, but as a fallback:
            console.error(chalk.red(`${emoji.get('warning')} Could not retrieve token. Please try logging in again.`));
            process.exit(1);
        }

        let packagesToProcess = packageNames;

        if (!packageNames || packageNames.length === 0) {
            console.log(chalk.blue(`${emoji.get('mag_right')} No package names provided. Attempting to install/update from project's package.json...`));
            const projectPackageJsonPath = path.join(process.cwd(), 'package.json');
            try {
                if (!await fs.pathExists(projectPackageJsonPath)) {
                    console.log(chalk.yellow(`${emoji.get('warning')} No package.json found in the current directory. Nothing to install.`));
                    process.exit(0);
                }
                const projectPackageJson = await fs.readJson(projectPackageJsonPath);
                const cbuiDeps = projectPackageJson.crossbuildui && projectPackageJson.crossbuildui.dependencies;

                if (cbuiDeps && Object.keys(cbuiDeps).length > 0) {
                    packagesToProcess = Object.keys(cbuiDeps); // These are the names like "@crossbuildui/button"
                    console.log(chalk.blue(`${emoji.get('clipboard')} Will process CrossBuild UI components from package.json: ${chalk.bold(packagesToProcess.join(', '))}`));
                } else {
                    console.log(chalk.yellow(`${emoji.get('open_file_folder')} No CrossBuild UI dependencies found in package.json under 'crossbuildui.dependencies'. Nothing to install.`));
                    process.exit(0);
                }
            } catch (error) {
                console.error(chalk.red(`${emoji.get('boom')} Error reading package.json: ${error.message}`));
                process.exit(1);
            }
        }

        if (packagesToProcess && packagesToProcess.length > 0) {
            await downloadPackage(packagesToProcess, token);
        } else {
            console.log(chalk.yellow(`${emoji.get('shrug')} No packages specified or found to install.`));
        }
    });

program
    .command('update [packageNames...]')
    .description(`${emoji.get('rocket')} Update components to their latest versions.`)
    .option('-a, --all', 'Update all components listed in package.json')
    .action(async (packageNames, options) => {
        if (!(await isAuthenticated())) {
            console.error(chalk.red(`${emoji.get('no_entry_sign')} Authentication required. Please run ${chalk.bold('cbui-cli login')} first.`));
            process.exit(1);
        }
        const token = await getToken();
        if (!token) {
            console.error(chalk.red(`${emoji.get('warning')} Could not retrieve token. Please try logging in again.`));
            process.exit(1);
        }

        let packagesToProcess = packageNames;

        if (options.all) {
            if (packageNames && packageNames.length > 0) {
                console.error(chalk.red(`${emoji.get('no_entry')} Cannot use --all option with specific package names.`));
                process.exit(1);
            }
            // Logic to read from package.json (similar to install command)
            console.log(chalk.blue(`${emoji.get('mag_right')} --all specified. Attempting to update all components from project's package.json...`));
            const projectPackageJsonPath = path.join(process.cwd(), 'package.json');
            try {
                if (!await fs.pathExists(projectPackageJsonPath)) {
                    console.log(chalk.yellow(`${emoji.get('warning')} No package.json found. Cannot determine components to update.`));
                    process.exit(0);
                }
                const projectPackageJson = await fs.readJson(projectPackageJsonPath);
                const cbuiDeps = projectPackageJson.crossbuildui && projectPackageJson.crossbuildui.dependencies;
                if (cbuiDeps && Object.keys(cbuiDeps).length > 0) {
                    packagesToProcess = Object.keys(cbuiDeps);
                    console.log(chalk.blue(`${emoji.get('clipboard')} Will update CrossBuild UI components from package.json: ${chalk.bold(packagesToProcess.join(', '))}`));
                } else {
                    console.log(chalk.yellow(`${emoji.get('open_file_folder')} No CrossBuild UI dependencies found in package.json to update.`));
                    process.exit(0);
                }
            } catch (error) {
                console.error(chalk.red(`${emoji.get('boom')} Error reading package.json: ${error.message}`));
                process.exit(1);
            }
        } else if (!packageNames || packageNames.length === 0) {
            console.error(chalk.red(`${emoji.get('question')} Please specify package names to update or use the --all option.`));
            program.commands.find(cmd => cmd.name() === 'update').help();
            process.exit(1);
        }

        if (packagesToProcess && packagesToProcess.length > 0) {
            await downloadPackage(packagesToProcess, token);
        } else {
            // This case should be handled by the logic above, but as a safeguard
            console.log(chalk.yellow(`${emoji.get('shrug')} No packages specified or found to update.`));
        }
    });

program
    .command('status')
    .description(`${emoji.get('mag')} Check current authentication status`)
    .action(async () => {
        const token = await getToken();
        if (token) {
            console.log(chalk.green(`${emoji.get('lock')} User is authenticated. Token is present. You're good to go! ${emoji.get('white_check_mark')}`));
        } else {
            console.log(chalk.yellow(`${emoji.get('warning')} Not authenticated. Please run ${chalk.bold('cbui-cli login')} to proceed.`));
        }
    });

program
    .command('init <projectName>')
    .description(`${emoji.get('package')} Initialize a new Expo project with CrossBuild UI setup. Example: cbui-cli init my-app`)
    .option('-t, --template <templateName>', 'Specify a project template (e.g., "default", "cbui-free")')
    .action(async (projectName, options) => {
        try {
            // initProject will handle its own process.exit calls
            await initProject(projectName, options.template);
        } catch (error) {
            // Fallback error display if initProject doesn't exit
            console.error(chalk.red(`${emoji.get('boom')} Failed to initialize project: ${error.message}`));
            process.exit(1);
        }
    });

program.parseAsync(process.argv).then(() => {
    if (process.argv.length <= 2) {
        program.help();
    }
});