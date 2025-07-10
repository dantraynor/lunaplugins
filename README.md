# Luna Plugins

This is a template & example of how to develop **[Tidal Luna](https://github.com/Inrixia/TidaLuna)** plugins.

## Getting Started

Follow these steps to create your own Luna plugin using this template:

### 1. Clone the Repository

```sh
git clone https://github.com/Inrixia/luna-template.git luna-plugins
cd luna-plugins
```

### 2. Install Node.js (if missing)

If you don't have Node.js installed, use [nvm](https://github.com/nvm-sh/nvm):

```sh
nvm install node
nvm use node
```

> This will install and use the latest Node.js version.

### 3. Enable pnpm via Corepack

[Corepack](https://nodejs.org/api/corepack.html) is included with Node.js 16.10+.

```sh
corepack enable
corepack prepare pnpm@latest --activate
```

### 4. Install Dependencies

```sh
pnpm install
```

### 5. Start Developing

- Edit files in the `plugins/Example` directory to build your plugin.
- Use `pnpm run watch` to build and serve with hot reload.

> While developing, you can install and test your plugin via the _DEV_ store that should appear under **Plugin Store** in **Luna Settings**  
> ![image](https://github.com/user-attachments/assets/c159bf00-6feb-41c8-8884-3d9e63070c19)

### 6. Update the README

Replace this README with information about your plugin:

- What it does
- How to use it
- Any configuration or setup steps

### 7. GitHub Actions: Workflow Permissions

If you want to use the included GitHub Action in (`.github`) to automatically create releases, you must set your repository workflow permissions to **Read and write permissions**:

1. Go to your repository's settings: `Settings > Actions > General` https://github.com/.../.../settings/actions
1. Under **Workflow permissions**, select **Read and write permissions**.
1. Click **Save**.

This allows the GitHub Action to create releases on your behalf.

### 8. Install your plugins from GitHub

After your action has build the plugins, you can install from the releases page.
For example for **@luna/example**  
https://github.com/.../.../releases/download/latest/luna.example

Or install the store with
https://github.com/.../.../releases/download/latest/store.json

### 9. PR [TidaLuna](https://github.com/Inrixia/TidaLuna) to add your store

You can open a PR to add your store url to the default stores in client if youd like <3

---

For more details, see the [Tidal Luna documentation](https://github.com/Inrixia/TidaLuna).
