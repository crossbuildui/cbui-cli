import fetch from 'node-fetch';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import * as tar from 'tar';
import chalk from 'chalk';
import * as emoji from 'node-emoji';
import ora from 'ora';

const CLI_CONFIG_DIR = path.join(os.homedir(), '.cbui-cli');
const DOWNLOADS_DIR = path.join(CLI_CONFIG_DIR, 'downloads');
// Assuming your Next.js app is running locally for development
// In production, this should be your deployed Next.js app URL
const API_BASE_URL = 'http://localhost:3000';
const SECURE_PACKAGES_ENDPOINT = `${API_BASE_URL}/api/packages`;

/**
 * Downloads and extracts/saves packages from the secure endpoint.
 * @param {string[]} packageNames - Array of package filenames (e.g., ["component-a.tgz", "component-b.tgz"]).
 * @param {string} idToken - Firebase Auth ID token.
 */
export async function downloadPackage(packageNames, idToken) {
    const mainSpinner = ora(`Preparing to download components: ${chalk.bold(packageNames.join(', '))}`).start();

    try {
        await fs.ensureDir(DOWNLOADS_DIR);
        
        mainSpinner.text = `Requesting ${packageNames.length} component(s) from server...`;
        const response = await fetch(SECURE_PACKAGES_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`,
            },
            body: JSON.stringify({ components: packageNames }),
        });

        if (!response.ok) {
            mainSpinner.fail(chalk.red(`${emoji.get('x')} Failed to initiate download.`));
            let errorMsg = `HTTP error! status: ${response.status}`;
            try {
                const errorBody = await response.json();
                errorMsg = errorBody.message || errorMsg;
            } catch (e) {
                // Ignore JSON parsing error if response is not JSON
            }
            console.error(chalk.red(`${emoji.get('x')} Failed to download packages: ${errorMsg}. Please check your connection or try again.`));
            if (response.status === 401 || response.status === 403) {
                console.error(chalk.red(`${emoji.get('no_entry_sign')} Authentication failed! Your token might be expired. Please try running ${chalk.bold('cbui-cli logout')} then ${chalk.bold('cbui-cli login')} again. ${emoji.get('key')}`));
            } else if (response.status === 404) {
                console.error(chalk.red(`${emoji.get('mag_right')} One or more requested components not found or not authorized for your plan. Please check component names and your subscription.`));
            } else if (response.status === 429) {
                console.error(chalk.red(`${emoji.get('hourglass')} Rate limit exceeded. Please wait a bit and try again later.`));
            }
            process.exit(1);
        }

        const contentType = response.headers.get('content-type');
        const contentDisposition = response.headers.get('content-disposition');
        const filenameMatch = contentDisposition && contentDisposition.match(/filename="(.+)"/);
        const filename = filenameMatch ? filenameMatch[1] : 'downloaded_packages';

        mainSpinner.text = `Downloading ${chalk.cyan(filename)}...`;
        const downloadFilePath = path.join(DOWNLOADS_DIR, filename);

        // Stream the response to a file
        const fileStream = fs.createWriteStream(downloadFilePath);
        await new Promise((resolve, reject) => {
            response.body.pipe(fileStream);
            response.body.on('error', reject);
            fileStream.on('finish', resolve);
            fileStream.on('error', reject);
        });
        mainSpinner.succeed(`Downloaded archive ${chalk.cyan(filename)} successfully.`);

        const projectRoot = process.cwd();
        // Determine the base directory for CrossBuild UI components
        const srcDir = path.join(projectRoot, 'src');
        let baseCbuiDir = projectRoot;
        if (await fs.pathExists(srcDir) && (await fs.stat(srcDir)).isDirectory()) {
            baseCbuiDir = srcDir;
        }
        const cbuiComponentsDir = path.join(baseCbuiDir, 'crossbuildui');
        await fs.ensureDir(cbuiComponentsDir);

        let installedPackagesInfo = []; // To collect info for package.json update
        let hasPeerDependencies = false;

        /**
         * Reads package name, version, and peerDependencies from a .tgz file's internal package.json.
         * Assumes package.json is at 'package/package.json' or 'package.json' within the archive.
         * @param {string} tgzPath Path to the .tgz file.
         * @returns {Promise<object|null>} Package info { name, version, peerDependencies } or null.
         */
        async function getPackageInfoFromTgz(tgzPath) {
            const pkgInfoSpinner = ora(`Reading package info from ${chalk.cyan(path.basename(tgzPath))}...`); // Start later if needed
            const tempExtractDir = path.join(os.tmpdir(), `cbui-cli-pkg-info-${path.basename(tgzPath, '.tgz')}-${Date.now()}`);
            await fs.ensureDir(tempExtractDir);
            try {
                await tar.extract({
                    file: tgzPath,
                    cwd: tempExtractDir,
                    // We are looking for 'package/package.json' or 'package.json'
                    filter: (p) => p === 'package/package.json' || p === 'package.json',
                });

                let packageJsonPath = path.join(tempExtractDir, 'package', 'package.json');
                if (!await fs.pathExists(packageJsonPath)) {
                    packageJsonPath = path.join(tempExtractDir, 'package.json');
                }

                if (await fs.pathExists(packageJsonPath)) {
                    // pkgInfoSpinner.start(); // Start only if we are about to succeed or fail with a message
                    const packageInfo = await fs.readJson(packageJsonPath);
                    // pkgInfoSpinner.succeed(`Read package info for ${chalk.bold(packageInfo.name || path.basename(tgzPath))}.`); // Too verbose for user
                    return {
                        name: packageInfo.name,
                        version: packageInfo.version,
                        peerDependencies: packageInfo.peerDependencies,
                        dependencies: packageInfo.dependencies, // Also get direct dependencies
                    };
                } else {
                    // pkgInfoSpinner.warn(`package.json not found inside ${chalk.cyan(path.basename(tgzPath))}.`); // Internal detail
                    console.warn(chalk.yellow(`Warning: package.json not found inside ${chalk.cyan(path.basename(tgzPath))}.`));
                    return null;
                }
            } catch (error) {
                // pkgInfoSpinner.fail(); // Spinner might not be started
                console.error(chalk.red(`${emoji.get('bug')} Error reading package information from ${chalk.cyan(path.basename(tgzPath))}: ${error.message}`));
                return null;
            } finally {
                await fs.remove(tempExtractDir).catch(err => { /* console.warn(chalk.dim(`Failed to remove temp dir: ${err.message}`)) */ }); // Silent cleanup
            }
        }

        /**
         * Installs a single .tgz component package.
         * Extracts only the 'dist/' content to 'projectRoot/crossbuildui/componentName/'.
         * Manages dependencies in the project's package.json.
         * @param {string} tgzPath Path to the .tgz file.
         */
        async function installComponentTgz(tgzPath) {
            const componentInstallSpinner = ora(`Preparing to install component from ${chalk.cyan(path.basename(tgzPath))}...`).start();
            const packageInfo = await getPackageInfoFromTgz(tgzPath);
            if (!packageInfo || !packageInfo.name || !packageInfo.version) {
                componentInstallSpinner.warn(chalk.yellow(`Could not get package info from ${chalk.cyan(path.basename(tgzPath))}. Skipping installation of this file.`));
                await fs.remove(tgzPath).catch(() => { }); // Clean up tgz
                return null;
            }

            // Derive component folder name (e.g., "button" from "@crossbuildui/button")
            const componentFolderName = packageInfo.name.split('/').pop();
            componentInstallSpinner.text = `Installing ${chalk.bold(packageInfo.name)}@${chalk.bold(packageInfo.version)}...`;
            const installPath = path.join(cbuiComponentsDir, componentFolderName); // User doesn't need to know exact path
            await fs.ensureDir(installPath);
            await fs.emptyDir(installPath); // Clear if it exists

            // console.log(chalk.yellow(`${emoji.get('wrench')} Installing ${chalk.bold(packageInfo.name)}@${chalk.bold(packageInfo.version)} ...`)); // Replaced by spinner

            const tempExtractDir = path.join(os.tmpdir(), `cbui-cli-extract-${componentFolderName}-${Date.now()}`);
            await fs.ensureDir(tempExtractDir);

            try {
                await tar.extract({
                    file: tgzPath,
                    cwd: tempExtractDir,
                    // No strip here, we'll look for package/dist
                });

                const distPathInArchive = path.join(tempExtractDir, 'package', 'dist');
                if (await fs.pathExists(distPathInArchive) && (await fs.stat(distPathInArchive)).isDirectory()) {
                    await fs.copy(distPathInArchive, installPath);
                    componentInstallSpinner.succeed(`Installed ${chalk.bold(packageInfo.name)}@${chalk.bold(packageInfo.version)}.`);
                } else {
                    componentInstallSpinner.warn(chalk.yellow(`${emoji.get('warning')} 'dist' folder not found in archive for ${packageInfo.name}. Component might not be structured as expected.`));
                    // Decide if we should still count this as "installed" for package.json crossbuildui.dependencies
                    // For now, let's assume if dist is missing, it's a partial success or warning.
                }

                if (packageInfo.peerDependencies && Object.keys(packageInfo.peerDependencies).length > 0) {
                    hasPeerDependencies = true;
                }
                if (packageInfo.dependencies && Object.keys(packageInfo.dependencies).length > 0) {
                    hasPeerDependencies = true; // Also treat direct deps as needing potential npm install
                }

                // Add component to installedPackagesInfo for updating project's crossbuildui.dependencies
                installedPackagesInfo.push(packageInfo);

                // Manage dependencies in the root project's package.json
                const projectPackageJsonPath = path.join(projectRoot, 'package.json');
                if (await fs.pathExists(projectPackageJsonPath)) {
                    const projectPkg = await fs.readJson(projectPackageJsonPath);
                    projectPkg.dependencies = projectPkg.dependencies || {};
                    let projectPkgModified = false;

                    const dependenciesToConsider = {
                        ...(packageInfo.dependencies || {}),
                        ...(packageInfo.peerDependencies || {}),
                    };

                    for (const depName in dependenciesToConsider) {
                        const depVersion = dependenciesToConsider[depName];
                        // Add to project dependencies if not already present
                        if (!projectPkg.dependencies[depName] && !(projectPkg.peerDependencies && projectPkg.peerDependencies[depName])) {
                            projectPkg.dependencies[depName] = depVersion;
                            projectPkgModified = true;
                            // componentInstallSpinner.info(chalk.blue(`${emoji.get('link')} Added missing dependency ${chalk.bold(depName)}@${chalk.bold(depVersion)} to project's package.json.`)); // A bit verbose
                        }
                    }

                    if (projectPkgModified) {
                        await fs.writeJson(projectPackageJsonPath, projectPkg, { spaces: 2 });
                        // componentInstallSpinner.succeed(chalk.green(`${emoji.get('pushpin')} Project package.json updated with new dependencies for ${packageInfo.name}.`)); // Covered by overall package.json update later
                        hasPeerDependencies = true; // Ensure npm install prompt
                    }
                }

            } catch (err) {
                componentInstallSpinner.fail(chalk.red(`${emoji.get('bomb')} Failed to install ${chalk.bold(packageInfo.name)}: ${err.message}`));
                await fs.remove(installPath).catch(() => { }); // Clean up failed install attempt
            } finally {
                await fs.remove(tempExtractDir).catch(e => { /* console.warn(chalk.dim(`Could not remove temp extraction dir: ${e.message}`)) */ });
                await fs.remove(tgzPath).catch(e => { /* console.warn(chalk.dim(`Could not remove ${tgzPath}: ${e.message}`)) */ });
            }
        }

        const processingSpinner = ora('Processing downloaded package(s)...').start();
        try {
            if (contentType && (contentType.includes('application/gzip') || filename.endsWith('.tgz') || filename.endsWith('.tar.gz'))) {
                // Handles .tgz or .tar.gz directly downloaded (assumed to be a single component)
                processingSpinner.text = `Processing component archive: ${chalk.cyan(filename)}`;
                await installComponentTgz(downloadFilePath); // This function has its own spinner for the specific component
                processingSpinner.succeed(`Processed component archive: ${chalk.cyan(filename)}.`);
                // downloadFilePath (original .tgz) is removed inside installComponentTgz

            } else if (contentType && contentType.includes('application/x-tar')) {
                // Handles .tar files.
                processingSpinner.text = `Extracting TAR archive: ${chalk.cyan(filename)}`;
                const tempExtractDir = path.join(DOWNLOADS_DIR, 'extracted_tar_contents', path.basename(filename, '.tar'));
                await fs.ensureDir(tempExtractDir);
                await fs.emptyDir(tempExtractDir); // Clean before extraction

                try {
                    await tar.extract({
                        file: downloadFilePath,
                        cwd: tempExtractDir
                    });
                    // processingSpinner.succeed(`Extracted TAR archive: ${chalk.cyan(filename)}.`); // Will be succeeded after installing components
                    processingSpinner.start(`Installing components from ${chalk.cyan(filename)}...`);
                    const itemsInTar = await fs.readdir(tempExtractDir);
                    let processedItems = 0;

                    for (const itemInTar of itemsInTar) {
                        const itemPath = path.join(tempExtractDir, itemInTar);
                        if (itemInTar.endsWith('.tgz') || itemInTar.endsWith('.tar.gz')) {
                            await installComponentTgz(itemPath); // itemPath is a .tgz, will be cleaned up by installComponentTgz
                            processedItems++;
                        } else {
                            // processingSpinner.warn(chalk.dim(`Skipping non-tgz item in TAR archive: ${itemInTar}`)); // Internal detail
                        }
                    }
                    if (processedItems > 0) {
                        processingSpinner.succeed(`Installed ${processedItems} component(s) from ${chalk.cyan(filename)}.`);
                    } else {
                        processingSpinner.info(`No .tgz components found to install in ${chalk.cyan(filename)}.`);
                    }

                    await fs.remove(tempExtractDir); // Clean up temporary extraction directory
                    await fs.remove(downloadFilePath); // Clean up original .tar file
                } catch (tarExtractError) {
                    processingSpinner.fail(chalk.red(`Error processing TAR archive ${filename}: ${tarExtractError.message}`));
                    await fs.remove(tempExtractDir).catch(() => { /* Best effort cleanup */ });
                    throw tarExtractError;
                }
            } else {
                processingSpinner.warn(chalk.yellow(`${emoji.get('floppy_disk')} Downloaded file ${chalk.cyan(filename)} with unhandled content type: ${chalk.bold(contentType)}. Manual installation may be required.`));
            }
            if (processingSpinner.isSpinning) processingSpinner.succeed('Package processing complete.'); // Catch-all success
            // After all processing, update project's package.json
            if (installedPackagesInfo.length > 0) {
                const projectPackageJsonPath = path.join(projectRoot, 'package.json');
                if (!await fs.pathExists(projectPackageJsonPath)) {
                    console.error(chalk.red(`${emoji.get('rotating_light')} Error: ${chalk.bold('package.json')} not found at ${chalk.underline(projectPackageJsonPath)}. Cannot update dependencies automatically.`));
                    console.log(chalk.yellow(`${emoji.get('clipboard')} Please add these CrossBuild UI component references manually to your package.json under a 'crossbuildui.dependencies' key:`));
                    installedPackagesInfo.forEach(pkg => console.log(chalk.yellow(`  "${pkg.name}": "${pkg.version}"`)));
                } else {
                    try {
                        const pkgUpdateSpinner = ora('Updating project package.json with CrossBuild UI dependencies...').start();
                        const projectPackageJson = await fs.readJson(projectPackageJsonPath); // Re-read in case modified by dependency logic
                        // Store cbui components in a custom section to avoid conflicts with npm install
                        projectPackageJson.crossbuildui = projectPackageJson.crossbuildui || {};
                        projectPackageJson.crossbuildui.dependencies = projectPackageJson.crossbuildui.dependencies || {};

                        installedPackagesInfo.forEach(pkg => {
                            if (pkg.name && pkg.version) { // Ensure we have valid data
                                projectPackageJson.crossbuildui.dependencies[pkg.name] = pkg.version;
                                // pkgUpdateSpinner.info(chalk.blue(`${emoji.get('memo')} Added/Updated ${chalk.bold(pkg.name)}@${chalk.bold(pkg.version)} in project package.json under 'crossbuildui.dependencies'.`));
                            }
                        });
                        await fs.writeJson(projectPackageJsonPath, projectPackageJson, { spaces: 2 });
                        pkgUpdateSpinner.succeed(chalk.green(`${emoji.get('pushpin')} Project package.json updated with CrossBuild UI dependencies.`));
                    } catch (e) {
                        (pkgUpdateSpinner || ora()).fail(chalk.red(`${emoji.get('warning')} Error updating project ${chalk.bold('package.json')}: ${e.message}`));
                        console.log(chalk.yellow(`${emoji.get('clipboard')} Please record these CrossBuild UI component references manually (e.g., under a 'crossbuildui.dependencies' key in your package.json):`));
                        installedPackagesInfo.forEach(pkg => console.log(chalk.yellow(`  "${pkg.name}": "${pkg.version}"`)));
                    }
                }
                if (hasPeerDependencies) {
                    console.log(chalk.cyanBright(`\n${emoji.get('exclamation')} IMPORTANT: One or more installed Crossbuild UI components have peer dependencies.`));
                    console.log(chalk.cyanBright(`${emoji.get('exclamation')} Please run ${chalk.bold('npm install')} (or 'yarn install' / 'pnpm install') in your project to install these peer dependencies.`));
                } else {
                    console.log(chalk.greenBright(`\n${emoji.get('package')} CrossBuild UI components processed successfully.`));
                }
            } else {
                 console.log(chalk.yellow(`${emoji.get('shrug')} No components were installed or updated.`));
            }
            // console.log(chalk.green(`\n${emoji.get('white_check_mark')} Added crossbuildui components successfully.`)); // Covered by individual spinners
        } catch (installError) {
            (processingSpinner || ora()).fail(chalk.red(`${emoji.get('boom')} An error occurred during package installation: ${installError.message}`));
            throw installError; // Re-throw to be caught by the outer try-catch which has process.exit
        }
    } catch (error) {
        (mainSpinner || ora()).fail(chalk.red(`${emoji.get('construction')} An error occurred during the download process: ${error.message}`));
        process.exit(1);
    }
}