# ✨ Crossbuild UI CLI ✨

**Build Mobile Apps Faster. Way Faster.**

The Crossbuild UI CLI is your command-line companion for jumpstarting Expo projects and integrating stunning, pre-built UI components from [Crossbuild UI](https://crossbuildui.com) directly into your workflow.

---

## 🚀 Features

*   **Project Initialization**: Quickly scaffold new Expo projects with pre-configured templates.
*   **Component Installation**: Seamlessly download and integrate Crossbuild UI components.
*   **Authentication**: Securely log in to your Crossbuild UI account to access exclusive components and features.
*   **Component Updates**: Keep your Crossbuild UI components up-to-date with the latest versions.
*   **User-Friendly Interface**: Interactive prompts and clear feedback with spinners and emojis.

---

## 📦 Installation

To use the Crossbuild UI CLI, you'll need Node.js (LTS version recommended). You can install the CLI globally using npm or yarn:

```bash
npm install -g cbui-cli
# or
yarn global add cbui-cli
```

After installation, you can verify it by running:
```bash
cbui-cli --version
```

---

## 🛠️ Usage

The Crossbuild UI CLI provides several commands to help you manage your projects and components.

### General Help

To see all available commands and options:
```bash
cbui-cli --help
```

For help with a specific command:
```bash
cbui-cli help [command]
```

### `init <projectName>`

Initialize a new Expo project with Crossbuild UI setup.

```bash
cbui-cli init my-expo-app
```

**Options:**
*   `-t, --template <templateName>`: Specify a project template (e.g., "default", "cbui-free").
    ```bash
    cbui-cli init my-premium-app --template cbui-pro
    ```

This command will:
1.  Create a new directory with your `<projectName>`.
2.  Download the specified (or default) template from the Crossbuild UI GitHub repository.
3.  Customize `package.json` with your project name.
4.  Prompt you to customize `app.json` (name, slug, scheme) with intelligent defaults.
5.  Provide you with the next steps to get your project running.

### `login`

Authenticate with your Crossbuild UI account via the browser. This is required to download and install components.

```bash
cbui-cli login
```

This command will open your default web browser to the Crossbuild UI login page. After successful authentication, your credentials will be securely stored locally for future CLI use.

### `logout`

Clear your stored Crossbuild UI authentication credentials from your local machine.

```bash
cbui-cli logout
```

### `install [packageNames...]`

Install Crossbuild UI components into your current project.

*   **Install specific components:**
    ```bash
    cbui-cli install @Crossbuildui/button @Crossbuildui/card
    ```
*   **Install/update components from `package.json`:**
    If no package names are provided, the CLI will look for a `Crossbuildui.dependencies` section in your project's `package.json` and install/update those components to their latest versions.
    ```bash
    cbui-cli install
    ```

**Note:** You must be logged in (`cbui-cli login`) to use this command. Components are typically installed into a `Crossbuildui` directory (or `src/Crossbuildui` if `src` exists). Peer dependencies might be added to your project's `package.json`; you'll be prompted to run `npm install` (or equivalent) if this happens.

### `update [packageNames...]`

Update specified Crossbuild UI components to their latest versions.

*   **Update specific components:**
    ```bash
    cbui-cli update @Crossbuildui/button
    ```

**Options:**
*   `-a, --all`: Update all Crossbuild UI components listed in your project's `package.json` under `Crossbuildui.dependencies`.
    ```bash
    cbui-cli update --all
    ```

**Note:** You must be logged in (`cbui-cli login`) to use this command.

### `status`

Check your current Crossbuild UI authentication status.

```bash
cbui-cli status
```

---

## 🤝 Contributing

Contributions are welcome! If you'd like to contribute, please follow these steps:

1.  Fork the repository on GitHub.
2.  Clone your fork locally.
3.  Create a new branch for your feature or bug fix.
4.  Make your changes and commit them with clear, descriptive messages.
5.  Push your changes to your fork.
6.  Submit a pull request to the main repository.

Please ensure your code adheres to the project's coding standards and includes tests where appropriate.

---

## 📜 License

This project is licensed under the MIT License.

---

Happy Building! 🚀
The Crossbuild UI Team
