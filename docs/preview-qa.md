# Preview deployment QA

Use a dedicated QA directory and an isolated client profile or account. Project configuration can coexist with user-level production tools, so verify that only preview sourcing tools are loaded before taking actions.

```sh
npx @talent-summoner/setup --preview
```

Select your apps and enter the preview website's HTTPS origin. Create an API key on that same preview website and paste it into the hidden prompt. If Vercel protects the deployment, enter its automation bypass secret when prompted. Keep both secrets out of agent chats, command-line arguments, and Git.

Setup checks the connection and displays installation paths before writing files. The server and skill are named `talent-summoner-preview` and installed in the current project. The installer refuses tracked MCP configuration files and adds generated project configuration paths to `.gitignore`.

To test installer changes on the prerelease channel, use `npx @talent-summoner/setup@next --preview`. The `@next` tag selects a prerelease installer; `--preview` selects the preview backend. A new package version is not required for each application preview.

To test a local tarball after the [package checks](../CONTRIBUTING.md#local-development):

```sh
setup_version=$(node -p 'require("./package.json").version')
setup_archive="$PWD/artifacts/talent-summoner-setup-$setup_version.tgz"
cd /absolute/path/to/qa-directory
npm exec --package="$setup_archive" -- talent-summoner-setup --preview
```
